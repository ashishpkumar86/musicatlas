# backend/spotify_client.py

import base64
import hashlib
import os
import secrets
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.utils.logging import get_logger

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")
_spotify_redirect_env = os.environ.get("SPOTIFY_REDIRECT_URI")
_frontend_env = os.environ.get("FRONTEND_URL", "").rstrip("/")
if not _spotify_redirect_env and _frontend_env:
    _spotify_redirect_env = f"{_frontend_env}/auth/spotify/callback"
SPOTIFY_REDIRECT_URI = _spotify_redirect_env or "http://localhost:8000/auth/spotify/callback"

SPOTIFY_AUTH_BASE = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_BASE = "https://api.spotify.com/v1"

# For now we only need this scope to read the user's top artists
# https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks
SPOTIFY_SCOPES = "user-top-read"


class SpotifyAuthError(Exception):
    """Auth / config issues (missing env vars, bad responses, etc.)."""


class SpotifyAPIError(Exception):
    """Non-auth related Spotify API issues."""


logger = get_logger(__name__)
_app_token_cache: Dict[str, Any] = {}
_catalog_backoff_until = 0.0
_catalog_min_interval = 0.25  # quarter-second spacing to stay under burst limits
_catalog_last_call = 0.0


# ---------------------------------------------------------------------------
# PKCE helpers (same idea as in tidal_client.py)
# ---------------------------------------------------------------------------

def _generate_pkce_verifier() -> str:
    """
    Generate a high-entropy PKCE code_verifier (43–128 characters).
    """
    return secrets.token_urlsafe(64)


def _generate_pkce_challenge(verifier: str) -> str:
    """
    Derive the PKCE code_challenge from the verifier using SHA-256.
    """
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return challenge


def build_spotify_authorize_url_with_pkce(state: str) -> Tuple[str, str]:
    """
    Build the Spotify authorization URL (Authorization Code + PKCE) and return:
      (authorize_url, code_verifier)
    """
    if not SPOTIFY_CLIENT_ID:
        raise SpotifyAuthError("SPOTIFY_CLIENT_ID not set")

    code_verifier = _generate_pkce_verifier()
    code_challenge = _generate_pkce_challenge(code_verifier)

    params = {
        "client_id": SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "scope": SPOTIFY_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    authorize_url = f"{SPOTIFY_AUTH_BASE}?{urllib.parse.urlencode(params)}"
    return authorize_url, code_verifier


# ---------------------------------------------------------------------------
# Token + API helpers
# ---------------------------------------------------------------------------

def exchange_spotify_code_for_token(code: str, code_verifier: str) -> Dict[str, Any]:
    """
    Exchange auth code + PKCE verifier for access/refresh tokens.
    """
    if not SPOTIFY_CLIENT_ID:
        raise SpotifyAuthError("SPOTIFY_CLIENT_ID not set")
    if not SPOTIFY_REDIRECT_URI:
        raise SpotifyAuthError("SPOTIFY_REDIRECT_URI not set")

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": SPOTIFY_REDIRECT_URI,
        "client_id": SPOTIFY_CLIENT_ID,
        "code_verifier": code_verifier,
    }

    # Note: For PKCE, client_secret is technically optional, but we can still
    # send it from a trusted backend environment.
    if SPOTIFY_CLIENT_SECRET:
        data["client_secret"] = SPOTIFY_CLIENT_SECRET

    resp = requests.post(SPOTIFY_TOKEN_URL, data=data, timeout=10)
    if resp.status_code >= 400:
        logger.error(
            "Spotify token error status=%s body=%s",
            resp.status_code,
            resp.text,
        )
        raise SpotifyAuthError(
            f"Spotify token error {resp.status_code}: {resp.text}"
        )

    return resp.json()


def get_spotify_user_profile(access_token: str) -> Dict[str, Any]:
    """
    GET https://api.spotify.com/v1/me
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
    }
    resp = requests.get(f"{SPOTIFY_API_BASE}/me", headers=headers, timeout=10)
    if resp.status_code >= 400:
        logger.error(
            "Spotify /me error status=%s body=%s",
            resp.status_code,
            resp.text,
        )
        raise SpotifyAPIError(
            f"Spotify /me error {resp.status_code}: {resp.text}"
        )
    return resp.json()


def get_spotify_top_artists(
    access_token: str,
    limit: int = 20,
    time_range: str = "medium_term",
) -> List[Dict[str, Any]]:
    """
    GET https://api.spotify.com/v1/me/top/artists
    Docs: https://developer.spotify.com/documentation/web-api/reference/get-users-top-artists-and-tracks
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
    }
    params = {
        "limit": limit,
        "time_range": time_range,  # short_term, medium_term, long_term
    }
    resp = requests.get(
        f"{SPOTIFY_API_BASE}/me/top/artists",
        headers=headers,
        params=params,
        timeout=10,
    )
    if resp.status_code >= 400:
        logger.error(
            "Spotify top artists error status=%s body=%s",
            resp.status_code,
            resp.text,
        )
        raise SpotifyAPIError(
            f"Spotify top artists error {resp.status_code}: {resp.text}"
        )

    payload = resp.json() or {}
    return payload.get("items") or []


def get_spotify_artist(access_token: str, artist_id: str) -> Dict[str, Any]:
    """
    Fetch a single Spotify artist object by ID.
    """
    headers = {
        "Authorization": f"Bearer {access_token}",
    }
    url = f"{SPOTIFY_API_BASE}/artists/{artist_id}"

    resp = requests.get(url, headers=headers, timeout=10)
    if resp.status_code >= 400:
        logger.error(
            "Spotify artist error id=%s status=%s body=%s",
            artist_id,
            resp.status_code,
            resp.text,
        )
        raise SpotifyAPIError(
            f"Spotify artist error {resp.status_code}: {resp.text}"
        )

    return resp.json() or {}


def simplify_spotify_artist(artist: Dict[str, Any]) -> Dict[str, Any]:
    """
    Turn the full Spotify artist object into a smaller shape for the frontend.
    """
    images = artist.get("images") or []
    image_url = images[0]["url"] if images else None
    external = artist.get("external_urls") or {}
    spotify_url = external.get("spotify")
    followers_block = artist.get("followers") or {}

    return {
        "id": artist.get("id"),
        "name": artist.get("name"),
        "popularity": artist.get("popularity"),
        "genres": artist.get("genres") or [],
        "imageUrl": image_url,
        "spotifyUrl": spotify_url,
        "followers_total": followers_block.get("total"),
    }


# ---------------------------------------------------------------------------
# Client Credentials + catalog search (app-only)
# ---------------------------------------------------------------------------


def _get_cached_app_token() -> Optional[str]:
    """
    Return a cached app token if it hasn't expired yet.
    """
    token = _app_token_cache.get("access_token")
    expires_at = _app_token_cache.get("expires_at") or 0
    if token and expires_at > time.time():
        return token
    return None


def get_spotify_app_access_token() -> Optional[str]:
    """
    Fetch (and cache) an app-only access token using the Client Credentials Flow.
    """
    cached = _get_cached_app_token()
    if cached:
        return cached

    if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
        logger.warning("Spotify client credentials missing; skipping catalog enrichment")
        return None

    data = {
        "grant_type": "client_credentials",
    }
    try:
        resp = requests.post(
            SPOTIFY_TOKEN_URL,
            data=data,
            auth=(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET),
            timeout=10,
        )
    except Exception as exc:  # noqa: BLE001 - log and continue
        logger.warning("Spotify app token request failed: %s", exc)
        return None

    if resp.status_code >= 400:
        logger.warning(
            "Spotify app token error status=%s body=%s",
            resp.status_code,
            resp.text,
        )
        return None

    payload = resp.json() or {}
    access_token = payload.get("access_token")
    expires_in = payload.get("expires_in", 3600)

    if not access_token:
        logger.warning("Spotify app token missing in response")
        return None

    # Add a small buffer to avoid using an expired token.
    expires_at = time.time() + max(int(expires_in) - 60, 0)
    _app_token_cache["access_token"] = access_token
    _app_token_cache["expires_at"] = expires_at

    return access_token


def search_spotify_albums_catalog(
    album_name: str,
    artist_name: str,
    limit: int = 10,
    market: str = "DE",
) -> List[Dict[str, Any]]:
    """
    Search Spotify albums with an app token.
    Returns a list of raw album items (or empty list on failure).
    """
    global _catalog_backoff_until, _catalog_last_call

    token = get_spotify_app_access_token()
    if not token:
        return []

    now = time.time()
    if _catalog_backoff_until and now < _catalog_backoff_until:
        sleep_for = _catalog_backoff_until - now
        logger.info("[spotify] catalog search backing off for %.2fs", sleep_for)
        time.sleep(sleep_for)

    elapsed = now - _catalog_last_call
    if elapsed < _catalog_min_interval:
        time.sleep(_catalog_min_interval - elapsed)

    q_album = (album_name or "").replace('"', "")
    q_artist = (artist_name or "").replace('"', "")
    params = {
        "type": "album",
        "limit": limit,
        "market": market,
        "q": f'album:"{q_album}" artist:"{q_artist}"',
    }
    headers = {
        "Authorization": f"Bearer {token}",
    }

    try:
        resp = requests.get(
            f"{SPOTIFY_API_BASE}/search",
            headers=headers,
            params=params,
            timeout=10,
        )
        _catalog_last_call = time.time()
    except Exception as exc:  # noqa: BLE001 - log and skip
        logger.info("[spotify] catalog search failed for %r / %r: %s", album_name, artist_name, exc)
        return []

    if resp.status_code == 401:
        # Token expired or invalid; clear cache and let caller retry if desired.
        _app_token_cache.clear()
        logger.info("[spotify] catalog search unauthorized; cleared token cache")
        return []

    if resp.status_code == 429:
        retry_after_header = resp.headers.get("Retry-After")
        try:
            retry_after = float(retry_after_header) if retry_after_header else 1.0
        except ValueError:
            retry_after = 1.0

        _catalog_backoff_until = time.time() + max(retry_after, 1.0)
        logger.info(
            "[spotify] catalog rate limited; status=429 retry_after=%s backoff_until=%.2f",
            retry_after_header,
            _catalog_backoff_until,
        )
        return []

    if resp.status_code >= 400:
        logger.info(
            "[spotify] catalog search error status=%s body=%s",
            resp.status_code,
            resp.text,
        )
        return []

    payload = resp.json() or {}
    albums_block = payload.get("albums") or {}
    items = albums_block.get("items") or []
    return items
