"""Configuration and simple in-memory stores for the API."""

import os
from pathlib import Path
from typing import Dict, List

# Base directory for the backend package (one level above the app package).
BASE_DIR = Path(__file__).resolve().parent.parent.parent
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:8000/")
FRONTEND_DIR = (BASE_DIR / "static").resolve()

# Session + OAuth PKCE state storage (in-memory for dev only).
STATE_STORE: Dict[str, str] = {}
SESSIONS: Dict[str, Dict] = {}
SESSION_COOKIE_NAME = "music_atlas_session"

# CORS origins allowed in local development.
CORS_ORIGINS: List[str] = [
    "http://localhost:8000",
]

_env_frontend = os.environ.get("FRONTEND_URL")
if _env_frontend:
    CORS_ORIGINS.append(_env_frontend.rstrip("/"))

_env_cors = os.environ.get("CORS_ORIGINS")
if _env_cors:
    for origin in _env_cors.split(","):
        origin_clean = origin.strip().rstrip("/")
        if origin_clean:
            CORS_ORIGINS.append(origin_clean)

# de-dupe while preserving order
seen = set()
deduped: List[str] = []
for origin in CORS_ORIGINS:
    if origin not in seen:
        seen.add(origin)
        deduped.append(origin)
CORS_ORIGINS = deduped
