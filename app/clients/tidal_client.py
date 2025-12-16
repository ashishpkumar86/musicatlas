# app/clients/tidal_client.py

import base64
import hashlib
import os
import secrets
import time
import urllib.parse
from typing import Any, Dict, Optional

import requests

from app.utils.logging import get_logger

#from dotenv import load_dotenv

#load_dotenv()

logger = get_logger(__name__)

def _build_tidal_image_url_from_uuid(image_uuid: str) -> str:
    """
    Build a TIDAL image URL from an image/picture UUID.

    The classic pattern is:
      https://resources.tidal.com/images/{uuid-with-slashes}/640x640.jpg

    where uuid-with-slashes = uuid.replace("-", "/").
    """
    base = f"https://resources.tidal.com/images/{image_uuid.replace('-', '/')}"
    return f"{base}/640x640.jpg"

# ---------------------------------------------------------------------------
# Environment + token caching
# ---------------------------------------------------------------------------

CLIENT_ID = os.environ.get("TIDAL_CLIENT_ID")
CLIENT_SECRET = os.environ.get("TIDAL_CLIENT_SECRET")

_token: Optional[str] = None
_token_expiry: Optional[float] = None


class TidalAuthError(Exception):
    """Raised when TIDAL credentials are missing or invalid."""


class TidalAPIError(Exception):
    """Raised when a TIDAL API call fails."""


# ---------------------------------------------------------------------------
# TOKEN
# ---------------------------------------------------------------------------

def get_access_token() -> str:
    """
    Fetch (and cache) a TIDAL access token using client_credentials.
    """
    global _token, _token_expiry

    # Reuse cached token if still valid
    if _token and _token_expiry and time.time() < _token_expiry:
        return _token

    if not CLIENT_ID or not CLIENT_SECRET:
        raise TidalAuthError("TIDAL_CLIENT_ID or TIDAL_CLIENT_SECRET not set")

    resp = requests.post(
        "https://auth.tidal.com/v1/oauth2/token",
        data={"grant_type": "client_credentials"},
        auth=(CLIENT_ID, CLIENT_SECRET),
        timeout=10,
    )

    if resp.status_code >= 400:
        body_preview = (resp.text or "").strip()
        logger.error("TIDAL token error status=%s body=%s", resp.status_code, body_preview[:300])
        raise TidalAuthError(
            f"TIDAL token error {resp.status_code}: {body_preview[:300]}"
        )

    payload = resp.json()

    _token = payload["access_token"]
    _token_expiry = time.time() + payload.get("expires_in", 3600) - 60

    return _token


# ---------------------------------------------------------------------------
# SEARCH (still experimental — depends on TIDAL app entitlements)
# ---------------------------------------------------------------------------

def search_artist_raw(
    query: str,
    country_code: str = "DE",
    limit: int = 10,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Call TIDAL's /v2/searchResults/{query} endpoint and return the raw JSON.

    We're only interested in artist results here, so we ask TIDAL to include
    artists in the response.
    """
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.api+json",
    }

    # Path parameter: the search keyword, URL-encoded
    q = query.strip()
    path_query = urllib.parse.quote(q)

    url = f"https://openapi.tidal.com/v2/searchResults/{path_query}"

    # Query parameters: country, what to include, paging, explicit filter
    params = {
        "countryCode": country_code,
        "include": "artists",          # we only care about artists
        "limit": limit,
        "offset": offset,
        # You can tweak this; mirroring Swagger UI default:
        "explicitFilter": "include",   # or "exclude", or "include,exclude"
    }

    resp = requests.get(url, headers=headers, params=params, timeout=10)

    if resp.status_code >= 400:
        logger.error("TIDAL search error status=%s body=%s", resp.status_code, resp.text)
    resp.raise_for_status()

    return resp.json() or {}


def get_artist_raw(
    artist_id: str,
    country_code: str = "DE",
) -> Dict[str, Any]:
    """
    Fetch raw TIDAL artist data.
    """
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.api+json",
    }
    url = f"https://openapi.tidal.com/v2/artists/{artist_id}"
    params = {"countryCode": country_code}

    resp = requests.get(url, headers=headers, params=params, timeout=10)
    if resp.status_code >= 400:
        logger.error(
            "TIDAL raw artist error status=%s body=%s",
            resp.status_code,
            resp.text,
        )
    resp.raise_for_status()
    return resp.json() or {}


def get_artist_details(
    artist_id: str,
    country_code: str = "DE",
    include_followers: bool = False,
) -> Dict[str, Any]:
    """
    Fetch detailed TIDAL artist data (popularity, name, optional followers relationship).
    """
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.api+json",
    }
    params = {
        "countryCode": country_code,
    }
    if include_followers:
        params["include"] = "followers"

    url = f"https://openapi.tidal.com/v2/artists/{artist_id}"

    resp = requests.get(url, headers=headers, params=params, timeout=10)
    if resp.status_code >= 400:
        logger.error(
            "TIDAL artist details error status=%s body=%s",
            resp.status_code,
            resp.text,
        )
    resp.raise_for_status()
    return resp.json() or {}

def get_artist_profile_art_url(
    artist_id: str,
    country_code: str = "DE",
) -> Optional[str]:
    """
    Best-effort fetch of an artist's profile image URL from TIDAL OpenAPI.

    - Returns a URL string on success
    - Returns None on any error (including 429 rate limiting)
    - Does NOT raise on 429 to avoid log spam
    """
    access_token = get_access_token()
    if not access_token:
        return None

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.api+json",
    }
    params = {
        "countryCode": country_code,
        "include": "profileArt",
    }
    url = f"https://openapi.tidal.com/v2/artists/{artist_id}/relationships/profileArt"

    try:
        resp = requests.get(url, headers=headers, params=params, timeout=5)
    except Exception as exc:
        # Network-level error: soft fail, no image
        logger.warning(
            "[TIDAL profileArt] request failed for artist_id=%s error=%s",
            artist_id,
            exc,
        )
        return None

    # Rate limit → just skip image, don't spam logs
    if resp.status_code == 429:
        return None

    if not resp.ok:
        # For non-429 errors, keep a short log but don't raise
        logger.warning(
            "[TIDAL profileArt] status=%s for artist_id=%s",
            resp.status_code,
            artist_id,
        )
        return None

    try:
        data = resp.json()
    except ValueError:
        return None

    # Typical structure: data[0].attributes.files[0].href
    items = data.get("included") or data.get("data") or []
    if not isinstance(items, list) or not items:
        return None

    first = items[0]
    attrs = first.get("attributes") or {}
    files = attrs.get("files") or []
    if not files:
        return None

    file0 = files[0]
    href = file0.get("href")
    return href

# ---------------------------------------------------------------------------
# ARTIST SUMMARY (frontend-friendly structure)
# ---------------------------------------------------------------------------

def get_artist_summary(artist_id: str, country_code: str = "DE") -> Dict[str, Any]:
    """
    Fetch a frontend-friendly summary for a TIDAL artist.
    """
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.api+json",
    }
    params = {
        "countryCode": country_code,
    }

    artist_url = f"https://openapi.tidal.com/v2/artists/{artist_id}"
    
    try:
        resp = requests.get(
            artist_url,
            headers=headers,
            params={"countryCode": country_code},
            timeout=5,
        )

    except Exception as exc:
        logger.error(
            "[TIDAL artist] request failed for artist_id=%s error=%s",
            artist_id,
            exc,
        )
        raise TidalAPIError(f"TIDAL artist request failed for {artist_id}") from exc

    if resp.status_code == 429:
        # Hit rate limit → just return empty summary; caller will skip image
        logger.warning("[TIDAL artist] rate limited for artist_id=%s", artist_id)
        return {}

    if not resp.ok:
        logger.error(
            "[TIDAL artist] status=%s for artist_id=%s body=%s",
            resp.status_code,
            artist_id,
            resp.text,
        )
        raise TidalAPIError(
            f"TIDAL artist fetch failed: status {resp.status_code} for {artist_id}"
        )

    try:
        payload = resp.json() or {}
    except ValueError as exc:
        logger.error("[TIDAL artist] invalid JSON for artist_id=%s", artist_id)
        raise TidalAPIError("Invalid JSON from TIDAL artist response") from exc

    data = payload.get("data") or {}
    attrs = data.get("attributes") or {}
    links = data.get("links") or {}

    # 1) Popularity & name
    popularity = attrs.get("popularity", 0.0)
    name = attrs.get("name", "Unknown artist")

    # 2) Try to get an image from a direct picture/imageUuid field first
    image_url: Optional[str] = None
    picture_uuid = attrs.get("picture") or attrs.get("imageUuid")
    if picture_uuid:
        image_url = _build_tidal_image_url_from_uuid(str(picture_uuid))

    # 3) If that didn't work, fall back to the profileArt relationship endpoint
    if image_url is None:
        try:
            image_url = get_artist_profile_art_url(artist_id, country_code)
        except Exception as exc:
            logger.warning(
                "TIDAL profileArt lookup failed for artist_id=%s error=%s",
                artist_id,
                exc,
            )

    # 4) Find a good web URL for the artist
    tidal_url: Optional[str] = None

    # a) Some responses include links.web.href
    web_link = links.get("web")
    if isinstance(web_link, dict):
        tidal_url = web_link.get("href")

    # b) Alternatively, check attributes.externalLinks (like in searchResults)
    if tidal_url is None:
        ext_links = attrs.get("externalLinks") or []
        if isinstance(ext_links, list):
            for lnk in ext_links:
                href = lnk.get("href")
                if href:
                    tidal_url = href
                    break

    # c) Fallback: construct it from the artist ID
    if tidal_url is None:
        tidal_url = f"https://tidal.com/browse/artist/{data.get('id', artist_id)}"

    return {
        "id": data.get("id", artist_id),
        "name": name,
        "popularity": popularity,
        "artistTypes": attrs.get("artistTypes"),
        "tidalUrl": tidal_url,
        "imageUrl": image_url,
    }

def get_user_favorite_artists(
    access_token: str,
    user_id: str,
    country_code: str = "DE",
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Fetch the user's favorite artists ("My Collection" artists) from TIDAL
    using the official OpenAPI v2 endpoint:

      GET https://openapi.tidal.com/v2/userCollections/{user_id}/relationships/artists
          ?sort=artists.name
          &countryCode=DE
          &locale=en-US
          &include=artists
          &limit=...
          &offset=...

    We return the raw JSON from TIDAL (JSON:API style: data + included).
    """
    base_url = "https://openapi.tidal.com/v2"
    url = f"{base_url}/userCollections/{user_id}/relationships/artists"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.api+json",
    }
    params = {
        "countryCode": country_code,  # "DE" by default; you can switch to "US" if you prefer
        "locale": "en-US",
        "include": "artists",
        "sort": "artists.addedAt",
        "limit": limit,
        "offset": offset,
    }

    resp = requests.get(url, headers=headers, params=params, timeout=10)

    if resp.status_code >= 400:
        logger.error(
            "TIDAL favorites (v2) error status=%s body=%s",
            resp.status_code,
            resp.text,
        )

    resp.raise_for_status()
    return resp.json() or {}
# USER OAUTH (Authorization Code + PKCE)
# ---------------------------------------------------------------------------

_tidal_redirect_env = os.environ.get("TIDAL_REDIRECT_URI")
_frontend_env = os.environ.get("FRONTEND_URL", "").rstrip("/")
if not _tidal_redirect_env and _frontend_env:
    _tidal_redirect_env = f"{_frontend_env}/auth/tidal/callback"
# FastAPI route lives under /auth/tidal/callback
TIDAL_REDIRECT_URI = _tidal_redirect_env or "http://localhost:8000/auth/tidal/callback"

TIDAL_SCOPES = os.environ.get(
    "TIDAL_SCOPES",
    "user.read collection.read search.read playlists.read "
    "playlists.write entitlements.read collection.write",
)


class TidalUserAuthError(Exception):
    """Errors specific to the user OAuth flow."""


def _generate_pkce_verifier() -> str:
    """
    Generate a high-entropy PKCE code_verifier (43–128 characters,
    URL-safe as required by the spec).
    """
    # 64 bytes gives us a nice long random string
    # token_urlsafe returns a URL-safe base64 string
    return secrets.token_urlsafe(64)


def _generate_pkce_challenge(verifier: str) -> str:
    """
    Derive the PKCE code_challenge from the verifier using SHA-256.
    """
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return challenge


def build_authorize_url_with_pkce(state: str) -> tuple[str, str]:
    """
    Build the TIDAL authorization URL (with PKCE) and return:
      (authorize_url, code_verifier)

    The caller must store the code_verifier (keyed by state) so that it
    can be used later when exchanging the authorization code for tokens.
    """
    if not CLIENT_ID:
        raise TidalUserAuthError("TIDAL_CLIENT_ID not set")

    code_verifier = _generate_pkce_verifier()
    code_challenge = _generate_pkce_challenge(code_verifier)

    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": TIDAL_REDIRECT_URI,
        "scope": TIDAL_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    url = "https://login.tidal.com/authorize?" + urllib.parse.urlencode(params)
    return url, code_verifier


def exchange_code_for_token(code: str, code_verifier: str) -> Dict[str, Any]:
    """
    Exchange an authorization code + PKCE code_verifier for access/refresh tokens.

    Returns the JSON payload from TIDAL, e.g.:
    {
      "access_token": "...",
      "token_type": "Bearer",
      "expires_in": 3600,
      "refresh_token": "...",
      "scope": "user.read ..."
    }
    """
    if not CLIENT_ID or not CLIENT_SECRET:
        raise TidalUserAuthError("TIDAL_CLIENT_ID or TIDAL_CLIENT_SECRET not set")

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": TIDAL_REDIRECT_URI,
        "code_verifier": code_verifier,
    }

    resp = requests.post(
        "https://auth.tidal.com/v1/oauth2/token",
        data=data,
        auth=(CLIENT_ID, CLIENT_SECRET),
        timeout=10,
    )

    if resp.status_code >= 400:
        logger.error(
            "TIDAL token exchange failed status=%s body=%s",
            resp.status_code,
            resp.text,
        )
        raise TidalUserAuthError(
            f"TIDAL token exchange failed: {resp.status_code} {resp.text}"
        )

    return resp.json()
