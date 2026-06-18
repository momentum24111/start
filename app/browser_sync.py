from __future__ import annotations

import base64
import json
import re
import secrets
import threading
import time
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote

import httpx

STATUS_PRESENT = "vorhanden"
STATUS_DELETED_BY_USER = "gelöscht_durch_benutzer"
STATUS_MISSING_FROM_BROWSER = "verschwunden_aus_browser"

SCHEMA_VERSION = 2

GITHUB_BLOB_RE = re.compile(
    r"^https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/blob/(?P<ref>[^/]+)/(?P<path>.+?)/?$",
    re.IGNORECASE,
)
GITHUB_RAW_RE = re.compile(
    r"^https?://raw\.githubusercontent\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/(?P<ref>[^/]+)/(?P<path>.+?)/?$",
    re.IGNORECASE,
)

_config_lock = threading.RLock()
_sync_lock = threading.Lock()
_scheduler_stop = threading.Event()
_scheduler_thread: threading.Thread | None = None

_paths: dict[str, Path] = {}
_load_json: Callable[..., dict] | None = None
_save_json: Callable[..., None] | None = None
_create_backup: Callable[[Path], Path] | None = None
_migrate_config: Callable[[object], dict] | None = None


def configure(
    *,
    data_dir: Path,
    load_json: Callable[..., dict],
    save_json: Callable[..., None],
    create_backup: Callable[[Path], Path],
    migrate_config: Callable[[object], dict],
) -> None:
    global _paths, _load_json, _save_json, _create_backup, _migrate_config
    _paths = {
        "data_dir": data_dir,
        "state_file": data_dir / "browser_sync.json",
        "state_example": data_dir / "browser_sync.example.json",
        "config_file": data_dir / "config.json",
        "settings_file": data_dir / "settings.json",
    }
    _load_json = load_json
    _save_json = save_json
    _create_backup = create_backup
    _migrate_config = migrate_config


@contextmanager
def config_lock():
    with _config_lock:
        yield


def ensure_bootstrap() -> None:
    example = _paths["state_example"]
    target = _paths["state_file"]
    if not example.exists():
        example.write_text(
            json.dumps({"ids": {}, "lastSync": None}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    if not target.exists() and example.exists():
        target.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")


def default_browser_sync_settings() -> dict:
    return {
        "enabled": False,
        "githubFileUrl": "",
        "githubPat": "",
        "syncIntervalHours": 6,
    }


def normalize_browser_sync_settings(settings: dict | None) -> dict:
    raw = settings.get("browserSync") if isinstance(settings, dict) else None
    defaults = default_browser_sync_settings()
    if not isinstance(raw, dict):
        return defaults.copy()
    try:
        interval = float(raw.get("syncIntervalHours", defaults["syncIntervalHours"]))
    except (TypeError, ValueError):
        interval = defaults["syncIntervalHours"]
    interval = max(1.0, min(168.0, interval))
    return {
        "enabled": bool(raw.get("enabled", defaults["enabled"])),
        "githubFileUrl": str(raw.get("githubFileUrl") or "").strip(),
        "githubPat": str(raw.get("githubPat") or "").strip(),
        "syncIntervalHours": interval,
    }


def _timestamp_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _generate_bookmark_id() -> str:
    return secrets.token_hex(4)


def _load_migrated_config(*, context: str) -> dict:
    raw = _load_json(_paths["config_file"], context=context)
    return _migrate_config(raw)


def load_state() -> dict:
    ensure_bootstrap()
    data = _load_json(_paths["state_file"], context="browser_sync:load_state")
    if not isinstance(data, dict):
        data = {}
    if not isinstance(data.get("ids"), dict):
        data["ids"] = {}
    return data


def save_state(data: dict) -> None:
    _create_backup(_paths["state_file"])
    _save_json(_paths["state_file"], data, context="browser_sync:save_state")


def get_status() -> dict:
    state = load_state()
    last_sync = state.get("lastSync")
    if not isinstance(last_sync, dict):
        last_sync = None
    settings = normalize_browser_sync_settings(
        _load_json(_paths["settings_file"], context="browser_sync:status")
    )
    return {
        "enabled": settings["enabled"],
        "syncIntervalHours": settings["syncIntervalHours"],
        "lastSync": last_sync,
        "running": _sync_lock.locked(),
        "trackedIdCount": len(state.get("ids") or {}),
    }


def parse_github_location(url: str) -> tuple[str, str, str, str] | None:
    cleaned = url.strip()
    if not cleaned:
        return None
    for pattern in (GITHUB_BLOB_RE, GITHUB_RAW_RE):
        match = pattern.match(cleaned)
        if match:
            return (
                match.group("owner"),
                match.group("repo"),
                match.group("ref"),
                unquote(match.group("path")),
            )
    return None


def github_api_contents_url(owner: str, repo: str, path: str, ref: str) -> str:
    encoded_path = "/".join(segment for segment in path.split("/"))
    return f"https://api.github.com/repos/{owner}/{repo}/contents/{encoded_path}?ref={ref}"


def download_xbel_file(url: str, pat: str) -> str:
    location = parse_github_location(url)
    headers: dict[str, str] = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Start-BrowserSync",
    }
    if pat:
        headers["Authorization"] = f"Bearer {pat}"

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        if location:
            owner, repo, ref, path = location
            api_url = github_api_contents_url(owner, repo, path, ref)
            response = client.get(api_url, headers=headers)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("Unexpected GitHub API response")
            content = payload.get("content")
            encoding = payload.get("encoding")
            if not isinstance(content, str) or encoding != "base64":
                raise ValueError("GitHub file is not base64-encoded text content")
            return base64.b64decode(content).decode("utf-8")

        direct_headers = dict(headers)
        direct_headers["Accept"] = "application/xml,text/xml,text/plain,*/*"
        response = client.get(url, headers=direct_headers)
        response.raise_for_status()
        return response.text


def _element_local_tag(element: ET.Element) -> str:
    tag = element.tag
    return tag.split("}")[-1] if "}" in tag else tag


def _element_title(element: ET.Element) -> str:
    for child in element:
        if _element_local_tag(child) == "title":
            text = (child.text or "").strip()
            if text:
                return text
    return (element.get("title") or "").strip()


def _parse_xbel_node(
    element: ET.Element,
    folder_path: list[str],
    bookmarks: list[dict[str, str]],
    seen_ids: set[str],
) -> None:
    tag = _element_local_tag(element)
    if tag == "folder":
        title = _element_title(element)
        child_path = [*folder_path, title] if title else folder_path
        for child in element:
            _parse_xbel_node(child, child_path, bookmarks, seen_ids)
        return
    if tag != "bookmark":
        for child in element:
            _parse_xbel_node(child, folder_path, bookmarks, seen_ids)
        return
    browser_id = (element.get("id") or "").strip()
    href = (element.get("href") or "").strip()
    if not browser_id or not href or browser_id in seen_ids:
        return
    seen_ids.add(browser_id)
    title = (element.text or "").strip() or _element_title(element) or href
    entry: dict[str, str] = {"id": browser_id, "href": href, "title": title}
    if folder_path:
        entry["folderPath"] = " / ".join(folder_path)
    bookmarks.append(entry)


def parse_xbel_bookmarks(content: str) -> list[dict[str, str]]:
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid XBEL XML: {exc}") from exc

    bookmarks: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for child in root:
        _parse_xbel_node(child, [], bookmarks, seen_ids)
    return bookmarks


def _collect_bookmarks_by_browser_id(config: dict) -> dict[str, dict]:
    mapping: dict[str, dict] = {}
    bookmarks = config.get("bookmarks", [])
    if not isinstance(bookmarks, list):
        return mapping
    for bookmark in bookmarks:
        if not isinstance(bookmark, dict):
            continue
        browser_id = str(bookmark.get("browserId") or "").strip()
        if browser_id:
            mapping[browser_id] = bookmark
    return mapping


def _find_bookmark_by_id(config: dict, bookmark_id: str | None) -> dict | None:
    if not bookmark_id:
        return None
    bookmarks = config.get("bookmarks", [])
    if not isinstance(bookmarks, list):
        return None
    for bookmark in bookmarks:
        if isinstance(bookmark, dict) and bookmark.get("id") == bookmark_id:
            return bookmark
    return None


def _new_imported_bookmark(entry: dict[str, str]) -> dict:
    bookmark = {
        "id": _generate_bookmark_id(),
        "title": entry["title"],
        "url": entry["href"],
        "description": "",
        "image": "",
        "categoryIds": [],
        "sidebarCategoryIds": [],
        "favorite": False,
        "source": "browser-import",
        "openMode": "new-tab",
        "createdAt": _timestamp_now(),
        "browserId": entry["id"],
    }
    folder_path = str(entry.get("folderPath") or "").strip()
    if folder_path:
        bookmark["browserFolderPath"] = folder_path
    return bookmark


def _append_bookmark_to_config(config: dict, bookmark: dict) -> None:
    bookmarks = config.get("bookmarks")
    if not isinstance(bookmarks, list):
        bookmarks = []
        config["bookmarks"] = bookmarks
    bookmarks.append(bookmark)


def _set_id_state(state: dict, browser_id: str, *, status: str, bookmark_id: str | None) -> None:
    ids = state.setdefault("ids", {})
    if not isinstance(ids, dict):
        ids = {}
        state["ids"] = ids
    ids[browser_id] = {
        "status": status,
        "bookmarkId": bookmark_id,
        "updatedAt": _timestamp_now(),
    }


def _clear_browser_id_from_bookmark(config: dict, bookmark_id: str | None) -> None:
    bookmark = _find_bookmark_by_id(config, bookmark_id)
    if bookmark and "browserId" in bookmark:
        del bookmark["browserId"]


def handle_config_deletions(old_config: dict, new_config: dict, state: dict) -> bool:
    old_by_browser_id = _collect_bookmarks_by_browser_id(old_config)
    new_by_browser_id = _collect_bookmarks_by_browser_id(new_config)
    changed = False
    for browser_id in old_by_browser_id:
        if browser_id in new_by_browser_id:
            continue
        entry = (state.get("ids") or {}).get(browser_id)
        current_status = entry.get("status") if isinstance(entry, dict) else None
        if current_status == STATUS_DELETED_BY_USER:
            continue
        _set_id_state(state, browser_id, status=STATUS_DELETED_BY_USER, bookmark_id=None)
        changed = True
    return changed


def process_sync(*, trigger: str = "scheduled") -> dict:
    if not _sync_lock.acquire(blocking=False):
        return {"ok": False, "skipped": True, "reason": "sync_already_running"}

    settings = normalize_browser_sync_settings(
        _load_json(_paths["settings_file"], context="browser_sync:process_sync")
    )
    if not settings["enabled"]:
        _sync_lock.release()
        return {"ok": False, "skipped": True, "reason": "disabled"}

    file_url = settings["githubFileUrl"]
    if not file_url:
        _sync_lock.release()
        return {"ok": False, "skipped": True, "reason": "missing_url"}

    result: dict[str, Any] = {
        "ok": False,
        "trigger": trigger,
        "at": _timestamp_now(),
        "imported": 0,
        "disappeared": 0,
        "reimported": 0,
        "error": None,
    }

    try:
        with _config_lock:
            xbel_content = download_xbel_file(file_url, settings["githubPat"])
            xbel_bookmarks = parse_xbel_bookmarks(xbel_content)
            browser_ids_in_file = {entry["id"] for entry in xbel_bookmarks}

            state = load_state()
            config = _load_migrated_config(context="browser_sync:process_sync")
            config_changed = False
            state_changed = False

            for entry in xbel_bookmarks:
                browser_id = entry["id"]
                record = (state.get("ids") or {}).get(browser_id)
                status = record.get("status") if isinstance(record, dict) else None

                if status is None:
                    bookmark = _new_imported_bookmark(entry)
                    _append_bookmark_to_config(config, bookmark)
                    _set_id_state(
                        state,
                        browser_id,
                        status=STATUS_PRESENT,
                        bookmark_id=bookmark["id"],
                    )
                    config_changed = True
                    state_changed = True
                    result["imported"] += 1
                    continue

                if status == STATUS_PRESENT:
                    continue

                if status == STATUS_DELETED_BY_USER:
                    continue

                if status == STATUS_MISSING_FROM_BROWSER:
                    bookmark = _new_imported_bookmark(entry)
                    _append_bookmark_to_config(config, bookmark)
                    _set_id_state(
                        state,
                        browser_id,
                        status=STATUS_PRESENT,
                        bookmark_id=bookmark["id"],
                    )
                    config_changed = True
                    state_changed = True
                    result["reimported"] += 1

            ids = state.get("ids")
            if not isinstance(ids, dict):
                ids = {}
                state["ids"] = ids

            for browser_id, record in list(ids.items()):
                if browser_id in browser_ids_in_file:
                    continue
                if not isinstance(record, dict) or record.get("status") != STATUS_PRESENT:
                    continue
                bookmark_id = record.get("bookmarkId")
                bookmark_id_str = bookmark_id if isinstance(bookmark_id, str) else None
                _set_id_state(
                    state,
                    browser_id,
                    status=STATUS_MISSING_FROM_BROWSER,
                    bookmark_id=bookmark_id_str,
                )
                _clear_browser_id_from_bookmark(config, bookmark_id_str)
                config_changed = True
                state_changed = True
                result["disappeared"] += 1

            result["ok"] = True
            state["lastSync"] = {
                "at": result["at"],
                "ok": True,
                "trigger": trigger,
                "imported": result["imported"],
                "reimported": result["reimported"],
                "disappeared": result["disappeared"],
                "bookmarkCount": len(browser_ids_in_file),
                "error": None,
            }
            state_changed = True

            if config_changed:
                config["schemaVersion"] = SCHEMA_VERSION
                _create_backup(_paths["config_file"])
                _save_json(_paths["config_file"], config, context="browser_sync:process_sync")
            if state_changed:
                save_state(state)

            return result
    except Exception as exc:
        result["error"] = str(exc)
        try:
            with _config_lock:
                state = load_state()
                state["lastSync"] = {
                    "at": result["at"],
                    "ok": False,
                    "trigger": trigger,
                    "imported": 0,
                    "reimported": 0,
                    "disappeared": 0,
                    "error": str(exc),
                }
                save_state(state)
        except Exception:
            pass
        return result
    finally:
        _sync_lock.release()


def on_config_saved(old_config: dict, new_config: dict) -> None:
    with _config_lock:
        state = load_state()
        if handle_config_deletions(old_config, new_config, state):
            save_state(state)


def on_settings_saved() -> None:
    _scheduler_stop.set()
    if _scheduler_thread and _scheduler_thread.is_alive():
        _scheduler_thread.join(timeout=2.0)
    start_scheduler()


def _scheduler_loop() -> None:
    while not _scheduler_stop.is_set():
        try:
            settings = normalize_browser_sync_settings(
                _load_json(_paths["settings_file"], context="browser_sync:scheduler")
            )
            if settings["enabled"] and settings["githubFileUrl"]:
                threading.Thread(
                    target=process_sync,
                    kwargs={"trigger": "scheduled"},
                    name="browser-sync-run",
                    daemon=True,
                ).start()
                interval_seconds = max(3600.0, settings["syncIntervalHours"] * 3600.0)
            else:
                interval_seconds = 60.0
        except Exception:
            interval_seconds = 300.0

        deadline = time.monotonic() + interval_seconds
        while time.monotonic() < deadline:
            if _scheduler_stop.wait(timeout=min(30.0, max(0.0, deadline - time.monotonic()))):
                return


def start_scheduler() -> None:
    global _scheduler_thread
    _scheduler_stop.clear()
    ensure_bootstrap()
    _scheduler_thread = threading.Thread(target=_scheduler_loop, name="browser-sync-scheduler", daemon=True)
    _scheduler_thread.start()


def stop_scheduler() -> None:
    _scheduler_stop.set()
    if _scheduler_thread and _scheduler_thread.is_alive():
        _scheduler_thread.join(timeout=2.0)
