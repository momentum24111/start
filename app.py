from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

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


def normalize_icon_target(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if not parsed.scheme:
        raw_url = f"https://{raw_url.strip()}"
        parsed = urlparse(raw_url)
    if parsed.path and parsed.path != "/":
        return raw_url
    return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"


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


@app.get("/api/themes")
def get_themes() -> dict:
    return {"themes": list_themes()}


@app.get("/api/languages")
def get_languages() -> dict:
    return {"languages": list_languages()}


@app.post("/api/favicon")
async def post_favicon(payload: FaviconRequest) -> dict:
    normalized = normalize_icon_target(payload.url)
    file_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
    suffix = Path(urlparse(normalized).path).suffix or ".ico"
    if len(suffix) > 5:
        suffix = ".ico"
    filename = f"{file_hash}{suffix}"
    target_file = FAVICON_CACHE_DIR / filename

    if target_file.exists():
        return {"path": f"/static/assets/favicon-cache/{filename}"}

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=6.0) as client:
            response = await client.get(normalized)
            response.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Favicon download failed: {exc}") from exc

    content_type = response.headers.get("content-type", "")
    if "image" not in content_type and not target_file.suffix:
        raise HTTPException(status_code=400, detail="URL is not an image")

    target_file.write_bytes(response.content)
    return {"path": f"/static/assets/favicon-cache/{filename}"}


@app.exception_handler(RuntimeError)
def runtime_error_handler(_, exc: RuntimeError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc)})


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="root")


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=False)
