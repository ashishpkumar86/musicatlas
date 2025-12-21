"""FastAPI application entrypoint and router wiring."""

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.clients.musicbrainz_client import search_artist_summary as mb_search_artist_summary
from app.clients.tidal_client import TidalAuthError, get_access_token
from app.routers import auth, enrichment, musicbrainz, spotify, tidal, recs, taste
from app.utils.config import CORS_ORIGINS, FRONTEND_DIR, FRONTEND_URL

app = FastAPI(
    title="Music Atlas Backend (v2)",
    description="Clean version with stable TIDAL + MusicBrainz integration",
    version="0.2.0",
)

# ---------------------------------------------------------------------------
# Router registration
# ---------------------------------------------------------------------------

app.include_router(auth.router, prefix="/auth")
app.include_router(tidal.router, prefix="/tidal")
app.include_router(spotify.router, prefix="/spotify")
app.include_router(musicbrainz.router, prefix="/mb")
app.include_router(enrichment.router, prefix="/user")
app.include_router(enrichment.public_router)
app.include_router(recs.router, prefix="/recs")
app.include_router(taste.router, prefix="/taste")

# ---------------------------------------------------------------------------
# CORS (local dev only)
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# HEALTH ENDPOINTS
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/tidal")
def health_tidal():
    """
    Validates that:
    - TIDAL env vars exist
    - Token retrieval works
    """
    try:
        token = get_access_token()
        return {
            "status": "ok",
            "token_prefix": token[:10],
        }
    except TidalAuthError as e:
        raise HTTPException(status_code=500, detail=f"TIDAL auth error: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TIDAL error: {e}")


@app.get("/health/musicbrainz")
def health_musicbrainz():
    """
    Simple MusicBrainz health check: runs a tiny search for 'Meshuggah'.
    """
    try:
        result = mb_search_artist_summary(name="Meshuggah", limit=1)
        return {"status": "ok", "example_count": len(result)}
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"MusicBrainz error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


# ---------------------------------------------------------------------------
# FRONTEND STATIC (serve built frontend files)
# ---------------------------------------------------------------------------


@app.get("/")
def serve_index():
    """
    Serve the SPA index.
    """
    if not FRONTEND_DIR.exists():
        raise HTTPException(status_code=404, detail="Frontend directory not found")

    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend index not found")
    return FileResponse(index_path)


app.mount(
    "/static",
    StaticFiles(directory=str(FRONTEND_DIR), html=False),
    name="static",
)
