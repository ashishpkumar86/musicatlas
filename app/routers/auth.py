"""Authentication and session management routes."""

import os
import secrets
import time
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.clients.spotify_client import (
    SpotifyAPIError,
    SpotifyAuthError,
    build_spotify_authorize_url_with_pkce,
    exchange_spotify_code_for_token,
    get_spotify_user_profile,
)
from app.clients.tidal_client import (
    build_authorize_url_with_pkce,
    exchange_code_for_token,
)
from app.utils.config import FRONTEND_URL, SESSION_COOKIE_NAME, SESSIONS, STATE_STORE
from app.utils.session import ensure_session_defaults
from app.utils.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)

_env = os.getenv("APP_ENV") or os.getenv("ENV") or ""
IS_PROD = _env.lower() in {"prod", "production"}
COOKIE_SECURE = IS_PROD
COOKIE_SAMESITE = "none" if IS_PROD else "lax"


def get_current_session(request: Request) -> Dict:
    """
    Look up the current TIDAL/Spotify session using the session_id cookie.
    Raises 401 if there is no valid session.
    """
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=401, detail="Not logged in (no session cookie)")

    session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

    expires_at = session.get("expires_at")
    if expires_at is not None and time.time() > expires_at:
        SESSIONS.pop(session_id, None)
        raise HTTPException(status_code=401, detail="Session expired, please log in again")

    return ensure_session_defaults(session_id)


@router.get("/tidal/login")
def tidal_login():
    """
    Start the TIDAL OAuth flow (Authorization Code + PKCE).
    """
    state = secrets.token_urlsafe(16)
    authorize_url, code_verifier = build_authorize_url_with_pkce(state)

    STATE_STORE[state] = code_verifier

    return RedirectResponse(authorize_url)


@router.get("/spotify/login")
def spotify_login():
    """
    Start the Spotify OAuth flow (Authorization Code + PKCE).
    """
    state = secrets.token_urlsafe(16)
    authorize_url, code_verifier = build_spotify_authorize_url_with_pkce(state)

    STATE_STORE[state] = code_verifier

    return RedirectResponse(url=authorize_url, status_code=302)


@router.get("/tidal/callback")
def tidal_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    """
    OAuth callback endpoint for TIDAL.
    """
    if error:
        detail = f"TIDAL error: {error}"
        if error_description:
            detail += f" ({error_description})"
        raise HTTPException(status_code=400, detail=detail)

    if not code:
        raise HTTPException(status_code=400, detail="Missing 'code' in callback")

    if not state:
        raise HTTPException(status_code=400, detail="Missing 'state' in callback")

    code_verifier = STATE_STORE.pop(state, None)
    if not code_verifier:
        raise HTTPException(
            status_code=400,
            detail="Unknown or expired 'state' (no PKCE code_verifier)",
        )

    try:
        token_payload = exchange_code_for_token(code, code_verifier)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    now = time.time()
    expires_in = token_payload.get("expires_in") or 0

    session = {
        "user_id": token_payload.get("user_id"),
        "access_token": token_payload.get("access_token"),
        "refresh_token": token_payload.get("refresh_token"),
        "scope": token_payload.get("scope"),
        "token_type": token_payload.get("token_type"),
        "expires_at": now + expires_in if expires_in else None,
        "created_at": now,
        "mb_artist_mbids": [],
    }

    session_id = secrets.token_urlsafe(32)
    SESSIONS[session_id] = session

    response = RedirectResponse(url=FRONTEND_URL, status_code=302)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )

    return response


@router.get("/spotify/callback")
def spotify_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    """
    OAuth callback endpoint for Spotify.
    """
    if error:
        detail = f"Spotify error: {error}"
        if error_description:
            detail += f" ({error_description})"
        raise HTTPException(status_code=400, detail=detail)

    if not code:
        raise HTTPException(status_code=400, detail="Missing 'code' in Spotify callback")

    if not state:
        raise HTTPException(status_code=400, detail="Missing 'state' in Spotify callback")

    code_verifier = STATE_STORE.pop(state, None)
    if not code_verifier:
        raise HTTPException(
            status_code=400,
            detail="Unknown or expired 'state' (no PKCE code_verifier) for Spotify",
        )

    try:
        token_payload = exchange_spotify_code_for_token(code, code_verifier)
    except SpotifyAuthError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Unexpected Spotify token error: {e}")

    access_token = token_payload.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="Spotify token payload missing access_token")

    spotify_user_id = None
    spotify_display_name = None
    try:
        profile = get_spotify_user_profile(access_token)
        spotify_user_id = profile.get("id")
        spotify_display_name = profile.get("display_name")
    except SpotifyAPIError as e:
        logger.warning("Spotify /me error: %s", e)
    except Exception as e:
        logger.exception("Unexpected Spotify /me error: %s", e)

    now = time.time()
    expires_in = token_payload.get("expires_in") or 0

    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id and session_id in SESSIONS:
        session = ensure_session_defaults(session_id)
    else:
        session_id = secrets.token_urlsafe(32)
        session = {"mb_artist_mbids": []}

    session.update(
        {
            "spotify_access_token": access_token,
            "spotify_refresh_token": token_payload.get("refresh_token"),
            "spotify_scope": token_payload.get("scope"),
            "spotify_token_type": token_payload.get("token_type"),
            "spotify_expires_at": now + expires_in if expires_in else None,
            "spotify_user_id": spotify_user_id,
            "spotify_display_name": spotify_display_name,
        }
    )

    SESSIONS[session_id] = session

    response = RedirectResponse(url=FRONTEND_URL, status_code=302)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_id,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )
    return response


@router.get("/spotify/session")
def spotify_session(request: Request):
    """
    Return whether the current user is logged in with Spotify and basic info.
    """
    try:
        session = get_current_session(request)
    except HTTPException:
        return {"logged_in": False}

    access_token = session.get("spotify_access_token")
    if not access_token:
        return {"logged_in": False}

    return {
        "logged_in": True,
        "user_id": session.get("spotify_user_id"),
        "display_name": session.get("spotify_display_name"),
        "scope": session.get("spotify_scope"),
        "expires_at": session.get("spotify_expires_at"),
    }


@router.get("/session/mb-artist-mbids")
def get_session_mb_artist_mbids_route(current_session: Dict = Depends(get_current_session)):
    """
    Debug helper to inspect canonical MusicBrainz artist MBIDs saved in the session.
    """
    return {"mb_artist_mbids": current_session.get("mb_artist_mbids", [])}


@router.get("/tidal/session")
def get_tidal_session(request: Request):
    """
    Return basic info about the current TIDAL session (if any).
    """
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        return {"logged_in": False}

    session = SESSIONS.get(session_id)
    if not session:
        return {"logged_in": False}

    access_token = session.get("access_token")
    if not access_token:
        return {"logged_in": False}

    expires_at = session.get("expires_at")
    if expires_at is not None and time.time() > expires_at:
        session.pop("access_token", None)
        session.pop("refresh_token", None)
        session.pop("scope", None)
        session.pop("token_type", None)
        session.pop("expires_at", None)
        return {"logged_in": False}

    return {
        "logged_in": True,
        "user_id": session.get("user_id"),
        "scope": session.get("scope"),
        "expires_at": expires_at,
    }


@router.post("/tidal/logout")
def tidal_logout(request: Request):
    """
    Log out from the current TIDAL session:
      - remove it from the in-memory store
      - delete the session cookie
    """
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id and session_id in SESSIONS:
        SESSIONS.pop(session_id, None)

    response = JSONResponse({"logged_out": True})
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )
    return response
