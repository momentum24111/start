from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shutil
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
import uvicorn
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
APP_DIR = BASE_DIR / "app"

import importlib.util

_browser_sync_spec = importlib.util.spec_from_file_location(
    "browser_sync", APP_DIR / "browser_sync.py"
)
if _browser_sync_spec is None or _browser_sync_spec.loader is None:
    raise RuntimeError("browser_sync module not found")
browser_sync = importlib.util.module_from_spec(_browser_sync_spec)
_browser_sync_spec.loader.exec_module(browser_sync)

STATIC_DIR = APP_DIR / "static"
DATA_DIR = APP_DIR / "data"
BACKUP_DIR = DATA_DIR / "backups"
FAVICON_CACHE_DIR = STATIC_DIR / "assets" / "favicon-cache"
THEMES_DIR = STATIC_DIR / "themes"
LANGUAGES_DIR = STATIC_DIR / "languages"

CONFIG_EXAMPLE = DATA_DIR / "config.example.json"
SETTINGS_EXAMPLE = DATA_DIR / "settings.example.json"
CONFIG_FILE = DATA_DIR / "config.json"
SETTINGS_FILE = DATA_DIR / "settings.json"

SCHEMA_VERSION = 2
BOOKMARK_SOURCE_OPTIONS = frozenset({"manual", "browser-import"})
DEFAULT_BOOKMARK_SOURCE = "manual"

INDEX_HTML_MARKER = "__START_PKG_INITIAL_APP_TITLE__"
INDEX_HTML_PATH = STATIC_DIR / "index.html"

RUNTIME_STATE: dict = {
    "last_loaded_file": None,
    "last_loaded_at": None,
    "last_load_context": None,
    "last_written_file": None,
    "last_written_at": None,
    "last_write_context": None,
    "last_config_put_summary": None,
    "last_settings_put_summary": None,
}


class FaviconRequest(BaseModel):
    url: str = Field(min_length=3, max_length=4096)


class BookmarkMetadataRequest(BaseModel):
    url: str = Field(min_length=3, max_length=4096)


def ensure_directories() -> None:
    for directory in (DATA_DIR, BACKUP_DIR, FAVICON_CACHE_DIR, THEMES_DIR, LANGUAGES_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def ensure_file(target: Path, source: Path) -> None:
    if not source.exists():
        raise RuntimeError(f"Missing example file: {source}")
    if not target.exists():
        shutil.copy2(source, target)


def ensure_bootstrap() -> None:
    ensure_directories()
    ensure_file(CONFIG_FILE, CONFIG_EXAMPLE)
    ensure_file(SETTINGS_FILE, SETTINGS_EXAMPLE)


def _timestamp_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_json(path: Path, *, context: str = "unknown") -> dict:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    RUNTIME_STATE["last_loaded_file"] = str(path.resolve())
    RUNTIME_STATE["last_loaded_at"] = _timestamp_now()
    RUNTIME_STATE["last_load_context"] = context
    return data


def save_json(path: Path, data: dict, *, context: str = "unknown") -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    RUNTIME_STATE["last_written_file"] = str(path.resolve())
    RUNTIME_STATE["last_written_at"] = _timestamp_now()
    RUNTIME_STATE["last_write_context"] = context


def _normalize_bookmark_source(value: object) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in BOOKMARK_SOURCE_OPTIONS else DEFAULT_BOOKMARK_SOURCE


def _legacy_service_image(service: dict) -> str:
    cached = str(service.get("cachedIcon") or "").strip()
    icon_url = str(service.get("iconUrl") or "").strip()
    return cached or icon_url


UNSORTED_CATEGORY_ID = "unsorted"


def _normalize_bookmark(raw: dict, *, category_id: str | None = None) -> dict:
    category_ids = (
        [
            str(cid).strip()
            for cid in raw.get("categoryIds", [])
            if str(cid).strip() and str(cid).strip() != UNSORTED_CATEGORY_ID
        ]
        if isinstance(raw.get("categoryIds"), list)
        else ([category_id] if category_id and category_id != UNSORTED_CATEGORY_ID else [])
    )
    sidebar_category_ids = (
        [
            str(cid).strip()
            for cid in raw.get("sidebarCategoryIds", [])
            if str(cid).strip() and str(cid).strip() != UNSORTED_CATEGORY_ID
        ]
        if isinstance(raw.get("sidebarCategoryIds"), list)
        else []
    )
    bookmark: dict = {
        "id": str(raw.get("id") or "").strip(),
        "title": str(raw.get("title") or raw.get("name") or "").strip(),
        "url": str(raw.get("url") or "").strip(),
        "description": str(raw.get("description") or "").strip(),
        "image": str(raw.get("image") or _legacy_service_image(raw) or "").strip(),
        "categoryIds": category_ids,
        "sidebarCategoryIds": sidebar_category_ids,
        "favorite": bool(raw.get("favorite")),
        "source": _normalize_bookmark_source(raw.get("source")),
    }
    if raw.get("openMode"):
        bookmark["openMode"] = raw["openMode"]
    if raw.get("shortcut"):
        bookmark["shortcut"] = raw["shortcut"]
    browser_id = str(raw.get("browserId") or "").strip()
    if browser_id:
        bookmark["browserId"] = browser_id
    return bookmark


def _normalize_category_entry(raw: dict) -> dict:
    entry = {key: value for key, value in raw.items() if key != "services"}
    entry["type"] = str(entry.get("type") or "service-list").strip().lower()
    if entry["type"] not in {"service-list", "iframe"}:
        entry["type"] = "service-list"
    entry["iframeUrl"] = str(entry.get("iframeUrl") or "").strip()
    slots = entry.get("slots")
    entry["slots"] = slots if isinstance(slots, int) and slots in (1, 2, 3) else 1
    return entry


def _normalize_sidebar_category_entry(raw: dict) -> dict:
    icon = str(raw.get("icon") or "folder").strip() or "folder"
    return {
        "id": str(raw.get("id") or "").strip(),
        "name": str(raw.get("name") or "").strip(),
        "icon": icon,
    }


def _normalize_sidebar_category_bookmark_order(
    raw: object, sidebar_categories: list[dict], bookmarks: list[dict]
) -> dict[str, list[str]]:
    valid_category_ids = {
        str(category.get("id") or "").strip()
        for category in sidebar_categories
        if str(category.get("id") or "").strip() and str(category.get("id") or "").strip() != UNSORTED_CATEGORY_ID
    }
    valid_bookmark_ids = {str(bookmark.get("id") or "").strip() for bookmark in bookmarks}
    valid_bookmark_ids.discard("")
    source = raw if isinstance(raw, dict) else {}
    normalized: dict[str, list[str]] = {}

    for category_id in valid_category_ids:
        listed = source.get(category_id) if isinstance(source.get(category_id), list) else []
        seen: set[str] = set()
        order: list[str] = []
        for bookmark_id in listed:
            bid = str(bookmark_id or "").strip()
            if not bid or bid not in valid_bookmark_ids or bid in seen:
                continue
            seen.add(bid)
            order.append(bid)
        for bookmark in bookmarks:
            bid = str(bookmark.get("id") or "").strip()
            sidebar_category_ids = (
                bookmark.get("sidebarCategoryIds")
                if isinstance(bookmark.get("sidebarCategoryIds"), list)
                else []
            )
            if category_id not in sidebar_category_ids or bid in seen:
                continue
            order.append(bid)
            seen.add(bid)
        normalized[category_id] = order
    return normalized


def _normalize_category_bookmark_order(
    raw: object, categories: list[dict], bookmarks: list[dict]
) -> dict[str, list[str]]:
    valid_category_ids = {str(c.get("id") or "").strip() for c in categories}
    valid_category_ids.discard("")
    valid_bookmark_ids = {str(b.get("id") or "").strip() for b in bookmarks}
    valid_bookmark_ids.discard("")
    source = raw if isinstance(raw, dict) else {}
    normalized: dict[str, list[str]] = {}

    for category_id in valid_category_ids:
        listed = source.get(category_id) if isinstance(source.get(category_id), list) else []
        seen: set[str] = set()
        order: list[str] = []
        for bookmark_id in listed:
            bid = str(bookmark_id or "").strip()
            if not bid or bid not in valid_bookmark_ids or bid in seen:
                continue
            seen.add(bid)
            order.append(bid)
        for bookmark in bookmarks:
            bid = str(bookmark.get("id") or "").strip()
            category_ids = bookmark.get("categoryIds") if isinstance(bookmark.get("categoryIds"), list) else []
            if category_id not in category_ids or bid in seen:
                continue
            order.append(bid)
            seen.add(bid)
        normalized[category_id] = order
    return normalized


def _has_legacy_services(data: dict) -> bool:
    for entry in data.get("categories", []):
        if isinstance(entry, dict) and entry.get("services"):
            return True
    return False


def _extract_legacy_bookmarks_from_categories(
    raw_categories: object,
) -> tuple[list[dict], dict[str, list[str]]]:
    """Services aus Kategorien in flache Lesezeichen überführen."""
    bookmarks: list[dict] = []
    bookmark_by_id: dict[str, dict] = {}
    category_bookmark_order: dict[str, list[str]] = {}

    for raw_category in raw_categories if isinstance(raw_categories, list) else []:
        if not isinstance(raw_category, dict):
            continue
        category_id = str(raw_category.get("id") or "").strip()
        category_type = str(raw_category.get("type") or "service-list").strip().lower()
        if category_type == "iframe":
            continue

        order: list[str] = []
        for raw_service in raw_category.get("services", []):
            if not isinstance(raw_service, dict):
                continue
            service_id = str(raw_service.get("id") or "").strip()
            if not service_id:
                continue
            if service_id in bookmark_by_id:
                existing = bookmark_by_id[service_id]
                category_ids = existing.setdefault("categoryIds", [])
                if category_id and category_id not in category_ids:
                    category_ids.append(category_id)
            else:
                bookmark = _normalize_bookmark(raw_service, category_id=category_id or None)
                bookmark["id"] = service_id
                bookmark_by_id[service_id] = bookmark
                bookmarks.append(bookmark)
            order.append(service_id)
        if category_id:
            category_bookmark_order[category_id] = order

    return bookmarks, category_bookmark_order


def _merge_bookmark_lists(existing: list[dict], legacy: list[dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    for bookmark in existing:
        bid = str(bookmark.get("id") or "").strip()
        if bid:
            by_id[bid] = bookmark
    for bookmark in legacy:
        bid = str(bookmark.get("id") or "").strip()
        if not bid:
            continue
        if bid in by_id:
            merged = by_id[bid]
            for category_id in bookmark.get("categoryIds", []):
                category_ids = merged.setdefault("categoryIds", [])
                if category_id not in category_ids:
                    category_ids.append(category_id)
            if not str(merged.get("title") or "").strip() and bookmark.get("title"):
                merged["title"] = bookmark["title"]
            if not str(merged.get("url") or "").strip() and bookmark.get("url"):
                merged["url"] = bookmark["url"]
            if not str(merged.get("image") or "").strip() and bookmark.get("image"):
                merged["image"] = bookmark["image"]
        else:
            by_id[bid] = bookmark
    return list(by_id.values())


def migrate_config(data: object) -> dict:
    """Legacy-Config (services in Kategorien) in einheitliches Lesezeichenmodell überführen."""
    if not isinstance(data, dict):
        return {
            "schemaVersion": SCHEMA_VERSION,
            "categories": [],
            "sidebarCategories": [],
            "bookmarks": [],
            "categoryBookmarkOrder": {},
            "sidebarCategoryBookmarkOrder": {},
        }

    categories = [
        _normalize_category_entry(entry)
        for entry in data.get("categories", [])
        if isinstance(entry, dict)
        and str(entry.get("id") or "").strip()
        and str(entry.get("id") or "").strip() != UNSORTED_CATEGORY_ID
    ]
    sidebar_categories = [
        _normalize_sidebar_category_entry(entry)
        for entry in data.get("sidebarCategories", [])
        if isinstance(entry, dict)
        and str(entry.get("id") or "").strip()
        and str(entry.get("id") or "").strip() != UNSORTED_CATEGORY_ID
    ]
    existing_bookmarks = [
        _normalize_bookmark(entry)
        for entry in data.get("bookmarks", [])
        if isinstance(entry, dict)
    ] if isinstance(data.get("bookmarks"), list) else []

    legacy_bookmarks, legacy_order = _extract_legacy_bookmarks_from_categories(data.get("categories", []))
    bookmarks = _merge_bookmark_lists(existing_bookmarks, legacy_bookmarks)

    order_source: dict[str, list[str]] = {}
    raw_order = data.get("categoryBookmarkOrder")
    if isinstance(raw_order, dict):
        order_source.update(raw_order)
    for category_id, order in legacy_order.items():
        if category_id not in order_source or not order_source.get(category_id):
            order_source[category_id] = order
    order_source.pop(UNSORTED_CATEGORY_ID, None)

    sidebar_order_source: dict[str, list[str]] = {}
    raw_sidebar_order = data.get("sidebarCategoryBookmarkOrder")
    if isinstance(raw_sidebar_order, dict):
        sidebar_order_source.update(raw_sidebar_order)
    sidebar_order_source.pop(UNSORTED_CATEGORY_ID, None)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "categories": categories,
        "sidebarCategories": sidebar_categories,
        "bookmarks": bookmarks,
        "categoryBookmarkOrder": _normalize_category_bookmark_order(
            order_source, categories, bookmarks
        ),
        "sidebarCategoryBookmarkOrder": _normalize_sidebar_category_bookmark_order(
            sidebar_order_source, sidebar_categories, bookmarks
        ),
    }


def recover_config_from_backups() -> dict | None:
    """Versucht Lesezeichen aus dem neuesten Config-Backup wiederherzustellen."""
    if not BACKUP_DIR.exists():
        return None
    backups = sorted(
        BACKUP_DIR.glob("config.*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for backup_file in backups:
        try:
            with backup_file.open("r", encoding="utf-8") as file:
                backup_data = json.load(file)
            migrated = migrate_config(backup_data)
            if migrated.get("bookmarks"):
                return migrated
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            continue
    return None


def create_backup(path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_file = BACKUP_DIR / f"{path.stem}.{timestamp}.json"
    shutil.copy2(path, backup_file)
    return backup_file


def list_themes() -> list[str]:
    themes: list[str] = []
    for child in THEMES_DIR.iterdir():
        if child.is_dir() and (child / "theme.css").exists():
            themes.append(child.name)
    return sorted(themes)


def list_languages() -> list[dict]:
    languages: list[dict] = []
    for file in sorted(LANGUAGES_DIR.glob("*.json")):
        content = load_json(file, context="list_languages")
        languages.append(
            {
                "code": file.stem,
                "name": content.get("meta", {}).get("name", file.stem),
            }
        )
    return languages


def normalize_page_url(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if not parsed.scheme:
        return f"https://{raw_url.strip()}"
    return raw_url.strip()


def _parse_sizes_attr(sizes_val: str) -> int:
    """Largest edge length from a sizes attribute (e.g. '16x16 32x32')."""
    if not sizes_val or not sizes_val.strip():
        return 0
    lowered = sizes_val.lower()
    if "any" in lowered:
        return 256
    best = 0
    for part in re.split(r"[\s,]+", sizes_val.strip()):
        part = part.strip()
        if not part:
            continue
        match = re.match(r"^(\d+)\s*x\s*(\d+)$", part, flags=re.IGNORECASE)
        if match:
            width, height = int(match.group(1)), int(match.group(2))
            best = max(best, width, height)
    return best


def _infer_size_from_path(path: str) -> int:
    path_l = path.lower()
    for pattern in (
        r"favicon-(\d{2,4})\.png$",
        r"apple-icon-(\d{2,4})\.png$",
        r"icon-(\d{2,4})\.png$",
    ):
        match = re.search(pattern, path_l)
        if match:
            return int(match.group(1))
    return 0


def _rel_tokens(rel_raw: str) -> list[str]:
    return [t.strip().lower() for t in re.split(r"[\s,]+", rel_raw.strip()) if t.strip()]


def _rel_is_apple_touch(tokens: list[str]) -> bool:
    return any(t.startswith("apple-touch") for t in tokens)


def _link_tags(html: str) -> list[str]:
    return re.findall(r"<link\b[^>]*>", html, flags=re.IGNORECASE)


def _parse_link_tag(tag: str) -> tuple[str, str, str, str] | None:
    """href_raw, rel_raw, mime, sizes_val (may be empty)."""
    href_match = re.search(r"""href\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
    rel_match = re.search(r"""rel\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
    if not href_match or not rel_match:
        return None
    href_raw = href_match.group(1).strip()
    rel_raw = rel_match.group(1).strip()
    if not href_raw:
        return None
    type_match = re.search(r"""type\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
    sizes_match = re.search(r"""sizes\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
    mime = type_match.group(1).strip() if type_match else ""
    sizes_val = sizes_match.group(1).strip() if sizes_match else ""
    return href_raw, rel_raw, mime, sizes_val


def _entry_size_from_link(sizes_val: str, absolute: str) -> int:
    size = _parse_sizes_attr(sizes_val)
    if size == 0:
        size = _infer_size_from_path(urlparse(absolute).path or "")
    return size


def extract_web_manifest_urls(html: str, page_base_url: str) -> list[str]:
    """Absolute manifest URLs from <link rel=\"manifest\" …>."""
    seen: set[str] = set()
    out: list[str] = []
    for tag in _link_tags(html):
        parsed = _parse_link_tag(tag)
        if not parsed:
            continue
        href_raw, rel_raw, _, _ = parsed
        tokens = _rel_tokens(rel_raw)
        if "manifest" not in tokens:
            continue
        absolute = urljoin(page_base_url, href_raw)
        if absolute not in seen:
            seen.add(absolute)
            out.append(absolute)
    return out


def _html_link_svg_icon_entries(html: str, base_url: str) -> list[tuple[int, int, str]]:
    """
    Priority 0: SVG favicons from <link> (not apple-touch, not mask-icon, not manifest).
    Prefers declared image/svg+xml or .svg href (matches common high-quality icons).
    """
    out: list[tuple[int, int, str]] = []
    for tag in _link_tags(html):
        parsed = _parse_link_tag(tag)
        if not parsed:
            continue
        href_raw, rel_raw, mime, sizes_val = parsed
        tokens = _rel_tokens(rel_raw)
        if "manifest" in tokens:
            continue
        if _rel_is_apple_touch(tokens):
            continue
        rel_lower = rel_raw.lower()
        if "mask-icon" in rel_lower:
            continue
        if "icon" not in rel_lower:
            continue
        mime_l = mime.lower()
        path_l = (urlparse(href_raw).path or "").lower()
        is_svg = "image/svg+xml" in mime_l or path_l.endswith(".svg")
        if not is_svg:
            continue
        absolute = urljoin(base_url, href_raw)
        size = _entry_size_from_link(sizes_val, absolute)
        out.append((0, size, absolute))
    return out


def _html_link_png_non_apple_entries(html: str, base_url: str) -> list[tuple[int, int, str]]:
    """Priority 1: PNG from <link rel=…icon…> (excluding apple-touch)."""
    out: list[tuple[int, int, str]] = []
    for tag in _link_tags(html):
        parsed = _parse_link_tag(tag)
        if not parsed:
            continue
        href_raw, rel_raw, mime, sizes_val = parsed
        tokens = _rel_tokens(rel_raw)
        if "manifest" in tokens:
            continue
        if _rel_is_apple_touch(tokens):
            continue
        rel_lower = rel_raw.lower()
        if "mask-icon" in rel_lower:
            continue
        if "icon" not in rel_lower:
            continue
        mime_l = mime.lower()
        path_l = (urlparse(href_raw).path or "").lower()
        is_png = "image/png" in mime_l or path_l.endswith(".png")
        if not is_png:
            continue
        absolute = urljoin(base_url, href_raw)
        size = _entry_size_from_link(sizes_val, absolute)
        out.append((1, size, absolute))
    return out


def _html_link_apple_png_entries(html: str, base_url: str) -> list[tuple[int, int, str]]:
    """Priority 2: PNG apple-touch icons."""
    out: list[tuple[int, int, str]] = []
    for tag in _link_tags(html):
        parsed = _parse_link_tag(tag)
        if not parsed:
            continue
        href_raw, rel_raw, mime, sizes_val = parsed
        tokens = _rel_tokens(rel_raw)
        if "manifest" in tokens:
            continue
        if not _rel_is_apple_touch(tokens):
            continue
        mime_l = mime.lower()
        path_l = (urlparse(href_raw).path or "").lower()
        is_png = "image/png" in mime_l or path_l.endswith(".png")
        if not is_png:
            continue
        absolute = urljoin(base_url, href_raw)
        size = _entry_size_from_link(sizes_val, absolute)
        out.append((2, size, absolute))
    return out


def _manifest_png_entries_from_data(data: dict, manifest_url: str) -> list[tuple[int, int, str]]:
    """Priority 1: PNG icons declared in a Web App Manifest (same bucket as HTML PNG icons)."""
    out: list[tuple[int, int, str]] = []
    icons = data.get("icons")
    if not isinstance(icons, list):
        return out
    for icon in icons:
        if not isinstance(icon, dict):
            continue
        src = icon.get("src")
        if not isinstance(src, str) or not src.strip():
            continue
        href = src.strip()
        absolute = urljoin(manifest_url, href)
        mime = str(icon.get("type") or "").lower()
        path_l = (urlparse(absolute).path or "").lower()
        is_png = "image/png" in mime or path_l.endswith(".png")
        if not is_png:
            continue
        sizes_val = str(icon.get("sizes") or "")
        size = _entry_size_from_link(sizes_val, absolute)
        out.append((1, size, absolute))
    return out


async def _collect_manifest_png_entries(
    client: httpx.AsyncClient, html: str, page_base_url: str
) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []
    for manifest_url in extract_web_manifest_urls(html, page_base_url):
        try:
            response = await client.get(
                manifest_url,
                headers={
                    "accept": (
                        "application/manifest+json,application/json;q=0.9,"
                        "text/plain;q=0.1,*/*;q=0.05"
                    )
                },
            )
            response.raise_for_status()
            if len(response.content) > 2_000_000:
                continue
            data = json.loads(response.text.lstrip("\ufeff"))
            if not isinstance(data, dict):
                continue
            out.extend(_manifest_png_entries_from_data(data, manifest_url))
        except Exception:
            continue
    return out


def _finalize_favicon_candidates(scored: list[tuple[int, int, str]]) -> list[str]:
    """Sort by ascending priority, then descending declared size; first occurrence wins per URL."""
    scored.sort(key=lambda row: (row[0], -row[1]))
    seen: set[str] = set()
    ordered: list[str] = []
    for _, _, url in scored:
        if url in seen:
            continue
        seen.add(url)
        ordered.append(url)
    return ordered


def is_probably_image_url(url: str) -> bool:
    path = Path(urlparse(url).path or "")
    return path.suffix.lower() in {".ico", ".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif"}


def is_valid_image_bytes(data: bytes) -> bool:
    """Reject HTML/text error pages saved with a fake image extension."""
    if len(data) < 12:
        return False
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if len(data) >= 6 and data[:3] == b"GIF" and data[3:6] in (b"87a", b"89a"):
        return True
    if len(data) >= 3 and data[:2] == b"\xff\xd8":
        return True
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    if len(data) >= 4 and data[:4] == b"\x00\x00\x01\x00":
        return True
    sample = data[: min(len(data), 8192)].lstrip().lower()
    if sample.startswith(b"<svg"):
        return True
    if sample.startswith(b"<?xml") and b"<svg" in data[: min(len(data), 16384)].lower():
        return True
    return False


def _meta_tag_content(page_html: str, *keys: str) -> str:
    for key in keys:
        patterns = (
            rf'<meta[^>]+(?:property|name)\s*=\s*["\']{re.escape(key)}["\'][^>]+content\s*=\s*["\']([^"\']+)["\']',
            rf'<meta[^>]+content\s*=\s*["\']([^"\']+)["\'][^>]+(?:property|name)\s*=\s*["\']{re.escape(key)}["\']',
        )
        for pattern in patterns:
            match = re.search(pattern, page_html, flags=re.IGNORECASE)
            if match:
                return html.unescape(match.group(1).strip())
    return ""


def extract_page_title(page_html: str) -> str:
    meta_title = _meta_tag_content(page_html, "og:title", "twitter:title")
    if meta_title:
        return meta_title
    match = re.search(r"<title[^>]*>([^<]+)</title>", page_html, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return html.unescape(re.sub(r"\s+", " ", match.group(1)).strip())


def extract_page_description(page_html: str) -> str:
    return _meta_tag_content(page_html, "og:description", "twitter:description", "description")


def extract_preview_image_url(page_html: str, base_url: str) -> str:
    for key in ("og:image", "og:image:url", "twitter:image", "twitter:image:src"):
        raw = _meta_tag_content(page_html, key)
        if raw:
            return urljoin(base_url, raw)
    return ""


def _extract_og_image_url(page_html: str, base_url: str) -> str:
    for key in ("og:image", "og:image:url"):
        raw = _meta_tag_content(page_html, key)
        if raw:
            return urljoin(base_url, raw)
    return ""


def _extract_twitter_image_url(page_html: str, base_url: str) -> str:
    for key in ("twitter:image", "twitter:image:src"):
        raw = _meta_tag_content(page_html, key)
        if raw:
            return urljoin(base_url, raw)
    return ""


def _html_link_apple_icon_entries(html: str, base_url: str) -> list[tuple[int, str]]:
    """Largest apple-touch icons (any image format)."""
    out: list[tuple[int, str]] = []
    for tag in _link_tags(html):
        parsed = _parse_link_tag(tag)
        if not parsed:
            continue
        href_raw, rel_raw, _, sizes_val = parsed
        tokens = _rel_tokens(rel_raw)
        if "manifest" in tokens:
            continue
        if not _rel_is_apple_touch(tokens):
            continue
        absolute = urljoin(base_url, href_raw)
        size = _entry_size_from_link(sizes_val, absolute)
        out.append((size, absolute))
    return out


def _largest_png_favicon_url(
    html: str, base_url: str, manifest_entries: list[tuple[int, int, str]]
) -> str:
    scored: list[tuple[int, str]] = [
        (size, url) for _, size, url in _html_link_png_non_apple_entries(html, base_url)
    ]
    scored.extend((size, url) for _, size, url in manifest_entries)
    if not scored:
        return ""
    scored.sort(key=lambda row: -row[0])
    return scored[0][1]


async def resolve_bookmark_preview_image(
    client: httpx.AsyncClient, html: str, final_url: str
) -> tuple[str, str]:
    """
    Preview image URL and source key with priority:
    og:image, twitter:image, apple-touch-icon, largest PNG favicon, favicon.ico
    """
    base = final_url
    parsed_final = urlparse(final_url)
    page_favicon_ico = f"{parsed_final.scheme}://{parsed_final.netloc}/favicon.ico"

    image = _extract_og_image_url(html, base)
    if image:
        return image, "og_image"

    image = _extract_twitter_image_url(html, base)
    if image:
        return image, "twitter_image"

    apple_entries = _html_link_apple_icon_entries(html, base)
    if apple_entries:
        apple_entries.sort(key=lambda row: -row[0])
        return apple_entries[0][1], "apple_touch_icon"

    manifest_entries = await _collect_manifest_png_entries(client, html, base)
    image = _largest_png_favicon_url(html, base, manifest_entries)
    if image:
        return image, "png_favicon"

    return page_favicon_ico, "favicon"


def format_hostname_domain(hostname: str) -> str:
    host = str(hostname or "").strip().lower()
    if host.startswith("www."):
        return host[4:]
    return host


async def fetch_page_html(raw_url: str) -> tuple[str, str]:
    page_url = normalize_page_url(raw_url)
    async with httpx.AsyncClient(follow_redirects=True, timeout=6.0) as client:
        response = await client.get(
            page_url,
            headers={
                "accept": (
                    "text/html,application/xhtml+xml;q=0.9,"
                    "text/plain;q=0.8,*/*;q=0.5"
                )
            },
        )
        response.raise_for_status()
        return response.text, str(response.url)


async def resolve_favicon_candidates(raw_url: str) -> list[str]:
    """
    Build ordered favicon URLs (first working download wins in post_favicon):

    0. SVG <link rel=…icon…> (not apple-touch / mask-icon / manifest)
    1. Largest PNG from manifest icons and non–apple-touch <link> icons
    2. Largest PNG apple-touch-icon
    3. /favicon.ico on the final document origin (after redirects)
    4. /favicon.ico on the origin of the URL entered by the user
    """
    page_url = normalize_page_url(raw_url)
    parsed_input = urlparse(page_url)
    input_origin = f"{parsed_input.scheme}://{parsed_input.netloc}"
    input_favicon_ico = f"{input_origin}/favicon.ico"

    if is_probably_image_url(page_url):
        return [page_url]

    scored: list[tuple[int, int, str]] = []

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=6.0) as client:
            response = await client.get(
                page_url,
                headers={
                    "accept": (
                        "text/html,application/xhtml+xml;q=0.9,"
                        "text/plain;q=0.8,*/*;q=0.5"
                    )
                },
            )
            response.raise_for_status()
            final = urlparse(str(response.url))
            page_origin = f"{final.scheme}://{final.netloc}"
            page_favicon_ico = f"{page_origin}/favicon.ico"

            content_type = (response.headers.get("content-type") or "").lower()
            if "html" not in content_type:
                scored.append((3, 0, page_favicon_ico))
                scored.append((4, 0, input_favicon_ico))
                return _finalize_favicon_candidates(scored)

            base = str(response.url)
            html = response.text
            scored.extend(_html_link_svg_icon_entries(html, base))
            scored.extend(_html_link_png_non_apple_entries(html, base))
            scored.extend(await _collect_manifest_png_entries(client, html, base))
            scored.extend(_html_link_apple_png_entries(html, base))
            scored.append((3, 0, page_favicon_ico))
            scored.append((4, 0, input_favicon_ico))
    except Exception:
        scored.append((3, 0, input_favicon_ico))
        scored.append((4, 0, input_favicon_ico))

    return _finalize_favicon_candidates(scored)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_bootstrap()
    browser_sync.configure(
        data_dir=DATA_DIR,
        load_json=load_json,
        save_json=save_json,
        create_backup=create_backup,
        migrate_config=migrate_config,
    )
    browser_sync.ensure_bootstrap()
    browser_sync.start_scheduler()
    yield
    browser_sync.stop_scheduler()


app = FastAPI(title="Start", version="2.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)


def config_needs_save(raw: object, migrated: dict) -> bool:
    if not isinstance(raw, dict):
        return True
    if int(raw.get("schemaVersion") or 1) < SCHEMA_VERSION:
        return True
    if not isinstance(raw.get("bookmarks"), list):
        return True
    if _has_legacy_services(raw):
        return True
    raw_bookmarks = raw.get("bookmarks") if isinstance(raw.get("bookmarks"), list) else []
    migrated_bookmarks = migrated.get("bookmarks") if isinstance(migrated.get("bookmarks"), list) else []
    if len(migrated_bookmarks) > len(raw_bookmarks):
        return True
    return False


@app.get("/api/config")
def get_config() -> dict:
    raw = load_json(CONFIG_FILE, context="api:get_config")
    migrated = migrate_config(raw)
    if not migrated.get("bookmarks") and migrated.get("categories"):
        recovered = recover_config_from_backups()
        if recovered:
            migrated = recovered
    if config_needs_save(raw, migrated):
        create_backup(CONFIG_FILE)
        save_json(CONFIG_FILE, migrated, context="api:get_config:migrate")
    return migrated


@app.put("/api/config")
def put_config(payload: dict) -> dict:
    with browser_sync.config_lock():
        old_config = migrate_config(load_json(CONFIG_FILE, context="api:put_config:before"))
        normalized = migrate_config(payload)
        encoded = json.dumps(normalized, ensure_ascii=False, sort_keys=True).encode("utf-8")
        categories = normalized.get("categories", [])
        bookmarks = normalized.get("bookmarks", [])
        RUNTIME_STATE["last_config_put_summary"] = {
            "at": _timestamp_now(),
            "sha256": hashlib.sha256(encoded).hexdigest(),
            "bytes": len(encoded),
            "category_count": len(categories) if isinstance(categories, list) else 0,
            "bookmark_count": len(bookmarks) if isinstance(bookmarks, list) else 0,
        }
        create_backup(CONFIG_FILE)
        save_json(CONFIG_FILE, normalized, context="api:put_config")
        browser_sync.on_config_saved(old_config, normalized)
    return {"ok": True}


@app.get("/api/settings")
def get_settings() -> dict:
    return load_json(SETTINGS_FILE, context="api:get_settings")


@app.put("/api/settings")
def put_settings(payload: dict) -> dict:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    RUNTIME_STATE["last_settings_put_summary"] = {
        "at": _timestamp_now(),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "bytes": len(encoded),
        "keys": sorted(payload.keys()) if isinstance(payload, dict) else [],
    }
    create_backup(SETTINGS_FILE)
    save_json(SETTINGS_FILE, payload, context="api:put_settings")
    browser_sync.on_settings_saved()
    return {"ok": True}


@app.get("/api/browser-sync/status")
def get_browser_sync_status() -> dict:
    return browser_sync.get_status()


@app.post("/api/browser-sync/run")
def post_browser_sync_run() -> dict:
    return browser_sync.process_sync(trigger="manual")


@app.get("/api/debug/storage")
def get_debug_storage() -> dict:
    return {
        "runtime": {
            "pid": os.getpid(),
            "cwd": str(Path.cwd().resolve()),
            "base_dir": str(BASE_DIR.resolve()),
            "argv": list(sys.argv),
            "python_executable": sys.executable,
        },
        "paths": {
            "config_file": str(CONFIG_FILE.resolve()),
            "settings_file": str(SETTINGS_FILE.resolve()),
            "config_example": str(CONFIG_EXAMPLE.resolve()),
            "settings_example": str(SETTINGS_EXAMPLE.resolve()),
        },
        "last_io": dict(RUNTIME_STATE),
        "files": {
            "config_exists": CONFIG_FILE.exists(),
            "settings_exists": SETTINGS_FILE.exists(),
            "config_mtime": datetime.fromtimestamp(CONFIG_FILE.stat().st_mtime).isoformat(timespec="seconds")
            if CONFIG_FILE.exists()
            else None,
            "settings_mtime": datetime.fromtimestamp(SETTINGS_FILE.stat().st_mtime).isoformat(timespec="seconds")
            if SETTINGS_FILE.exists()
            else None,
        },
    }


def _exec_same_process() -> None:
    """Prozess durch denselben Interpreter mit identischen Argumenten ersetzen."""
    time.sleep(0.35)
    os.execv(sys.executable, [sys.executable, *sys.argv])


@app.post("/api/restart")
def post_restart() -> dict:
    threading.Thread(target=_exec_same_process, daemon=True).start()
    return {"ok": True}


@app.get("/api/themes")
def get_themes() -> dict:
    return {"themes": list_themes()}


@app.get("/api/languages")
def get_languages() -> dict:
    return {"languages": list_languages()}


@app.post("/api/bookmark-metadata")
async def post_bookmark_metadata(payload: BookmarkMetadataRequest) -> dict:
    page_url = normalize_page_url(payload.url)
    if is_probably_image_url(page_url):
        parsed = urlparse(page_url)
        return {
            "title": "",
            "description": "",
            "image": page_url,
            "imageSource": "favicon",
            "domain": format_hostname_domain(parsed.hostname or ""),
        }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=6.0) as client:
            response = await client.get(
                page_url,
                headers={
                    "accept": (
                        "text/html,application/xhtml+xml;q=0.9,"
                        "text/plain;q=0.8,*/*;q=0.5"
                    )
                },
            )
            response.raise_for_status()
            final_url = str(response.url)
            html = response.text
            image, image_source = await resolve_bookmark_preview_image(client, html, final_url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Metadata fetch failed: {exc}") from exc

    title = extract_page_title(html)
    description = extract_page_description(html)
    parsed = urlparse(final_url)
    domain = format_hostname_domain(parsed.hostname or "")

    return {
        "title": title,
        "description": description,
        "image": image,
        "imageSource": image_source,
        "domain": domain,
    }


@app.post("/api/favicon")
async def post_favicon(payload: FaviconRequest) -> dict:
    candidates = await resolve_favicon_candidates(payload.url)
    last_error: Exception | None = None

    async with httpx.AsyncClient(follow_redirects=True, timeout=6.0) as client:
        for candidate_url in candidates:
            file_hash = hashlib.sha256(candidate_url.encode("utf-8")).hexdigest()[:24]
            suffix = Path(urlparse(candidate_url).path).suffix or ".ico"
            if len(suffix) > 5:
                suffix = ".ico"
            filename = f"{file_hash}{suffix}"
            target_file = FAVICON_CACHE_DIR / filename

            if target_file.exists():
                cached = target_file.read_bytes()
                if is_valid_image_bytes(cached):
                    return {
                        "path": f"/static/assets/favicon-cache/{filename}",
                        "sourceUrl": candidate_url,
                    }
                try:
                    target_file.unlink()
                except OSError:
                    pass

            try:
                response = await client.get(candidate_url)
                response.raise_for_status()
            except Exception as exc:
                last_error = exc
                continue

            body = response.content
            if not is_valid_image_bytes(body):
                last_error = ValueError("Response is not a valid image")
                continue

            try:
                target_file.write_bytes(body)
            except OSError as exc:
                last_error = exc
                continue

            return {
                "path": f"/static/assets/favicon-cache/{filename}",
                "sourceUrl": candidate_url,
            }

    if last_error is not None:
        raise HTTPException(status_code=400, detail=f"Favicon download failed: {last_error}") from last_error
    raise HTTPException(status_code=400, detail="Favicon download failed")


@app.exception_handler(RuntimeError)
def runtime_error_handler(_, exc: RuntimeError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc)})


def _build_index_html() -> str:
    """Liefert index.html mit aktuellem App-Titel (kein sichtbarer Platzhalter beim ersten Paint)."""
    ensure_bootstrap()
    settings = load_json(SETTINGS_FILE, context="index_html")
    raw_title = str(settings.get("appTitle") or "").strip() or "Start"
    escaped = html.escape(raw_title, quote=False)
    template = INDEX_HTML_PATH.read_text(encoding="utf-8")
    if INDEX_HTML_MARKER not in template:
        raise RuntimeError(f"Missing inject marker {INDEX_HTML_MARKER!r} in index.html")
    return template.replace(INDEX_HTML_MARKER, escaped)


@app.get("/")
@app.get("/index.html")
def get_app_index() -> HTMLResponse:
    body = _build_index_html()
    return HTMLResponse(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="root")


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=False)
