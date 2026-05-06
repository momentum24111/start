from __future__ import annotations

import hashlib
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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
APP_DIR = BASE_DIR / "app"
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


class FaviconRequest(BaseModel):
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


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


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
        content = load_json(file)
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


def _favicon_link_tier(rel: str, mime: str, absolute_url: str) -> int:
    """
    Lower tier = try earlier. PNG raster icons before Apple Touch before SVG before ICO.
    """
    rel_l = rel.lower()
    mime_l = mime.lower()
    path = (urlparse(absolute_url).path or "").lower()

    if "apple-touch" in rel_l:
        return 1

    is_png = "image/png" in mime_l or path.endswith(".png")
    is_webp = "image/webp" in mime_l or path.endswith(".webp")
    is_jpeg = "image/jpeg" in mime_l or "image/jpg" in mime_l or path.endswith((".jpg", ".jpeg"))
    if is_png or is_webp or is_jpeg:
        return 0

    if "mask-icon" in rel_l or "image/svg" in mime_l or path.endswith(".svg"):
        return 2

    if (
        path.endswith(".ico")
        or "image/x-icon" in mime_l
        or mime_l == "image/vnd.microsoft.icon"
    ):
        return 3

    return 3


def extract_favicon_entries(html: str, base_url: str) -> list[dict]:
    """Parse <link> tags into prioritized favicon entries (url, tier, size)."""
    entries: list[dict] = []
    pattern = re.compile(r"<link\b[^>]*>", flags=re.IGNORECASE)

    for tag in pattern.findall(html):
        href_match = re.search(r"""href\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
        rel_match = re.search(r"""rel\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
        if not href_match or not rel_match:
            continue
        rel_raw = rel_match.group(1).strip()
        if "icon" not in rel_raw.lower():
            continue
        href_raw = href_match.group(1).strip()
        if not href_raw:
            continue

        type_match = re.search(r"""type\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
        sizes_match = re.search(r"""sizes\s*=\s*["']([^"']+)["']""", tag, flags=re.IGNORECASE)
        mime = type_match.group(1).strip() if type_match else ""
        sizes_val = sizes_match.group(1).strip() if sizes_match else ""

        absolute = urljoin(base_url, href_raw)
        tier = _favicon_link_tier(rel_raw, mime, absolute)
        size = _parse_sizes_attr(sizes_val)
        if size == 0:
            size = _infer_size_from_path(urlparse(absolute).path or "")

        entries.append({"url": absolute, "tier": tier, "size": size})

    return entries


def _merge_favicon_entries_by_url(entries: list[dict]) -> list[dict]:
    """Keep best metadata per URL: lower tier wins, then larger declared size."""
    merged: dict[str, dict] = {}
    for entry in entries:
        url = entry["url"]
        if url not in merged:
            merged[url] = entry
            continue
        current = merged[url]
        t_cur, s_cur = current["tier"], current["size"]
        t_new, s_new = entry["tier"], entry["size"]
        if t_new < t_cur or (t_new == t_cur and s_new > s_cur):
            merged[url] = entry
    return list(merged.values())


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


async def resolve_favicon_candidates(raw_url: str) -> list[str]:
    page_url = normalize_page_url(raw_url)
    parsed = urlparse(page_url)
    origin_fallback = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"

    # If URL already points to an image path, prioritize this direct target.
    if is_probably_image_url(page_url):
        return [page_url]

    html_entries: list[dict] = []
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=6.0) as client:
            response = await client.get(page_url, headers={"accept": "text/html,*/*"})
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "html" in content_type:
                html_entries = extract_favicon_entries(response.text, str(response.url))
    except Exception:
        pass

    merged = _merge_favicon_entries_by_url(html_entries)
    merged.sort(key=lambda e: (e["tier"], -e["size"]))
    candidates = [e["url"] for e in merged]

    if origin_fallback not in candidates:
        candidates.append(origin_fallback)
    return candidates


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_bootstrap()
    yield


app = FastAPI(title="Start", version="2.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.get("/api/config")
def get_config() -> dict:
    return load_json(CONFIG_FILE)


@app.put("/api/config")
def put_config(payload: dict) -> dict:
    create_backup(CONFIG_FILE)
    save_json(CONFIG_FILE, payload)
    return {"ok": True}


@app.get("/api/settings")
def get_settings() -> dict:
    return load_json(SETTINGS_FILE)


@app.put("/api/settings")
def put_settings(payload: dict) -> dict:
    create_backup(SETTINGS_FILE)
    save_json(SETTINGS_FILE, payload)
    return {"ok": True}


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


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="root")


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=False)
