# backend/musicbrainz_client.py

"""
Simple, rate-limit-friendly MusicBrainz client for Music Atlas.

We use this client for:
- Searching artists by name
- Fetching detailed artist info (tags, members, etc.)

Design goals:
- Always send a proper, identifiable User-Agent (required by MusicBrainz).
- Stay within ~1 request/second *on average* to avoid throttling.
- Handle 503 / network errors with polite retries and backoff.
- Keep a small, beginner-friendly API surface.
"""

import datetime
import random
import time
from typing import Any, Dict, List, Optional

import requests
from requests.exceptions import RequestException, SSLError

from app.config import settings
from app.data.musicbrainz_db import (
    get_artist_by_mbid_db,
    get_artist_release_groups_db,
    get_artist_tags_db,
    search_artists_by_name_db,
)
from app.utils.logging import get_logger


# === Configuration ==========================================================

# Base URL for the MusicBrainz web service (HTTPS, as recommended).
_MB_BASE_URL = "https://musicbrainz.org/ws/2"

# HARD-CODED USER-AGENT (per your request)
# MusicBrainz requires a meaningful User-Agent that identifies your app
# and provides a way to contact you.
#
# Format they recommend:
#   ApplicationName/version (contact-url-or-email)
#
# This string keeps you clearly identifiable and non-anonymous.
_MB_USER_AGENT = "MusicAtlas/0.1 ( https://github.com/ashish/music-atlas )"

# Minimum interval between requests (seconds).
# MusicBrainz suggests ~1 request/second per IP on average.
# We add a small safety buffer.
_MB_MIN_INTERVAL_SEC = 1.1

# Max retries for transient errors (network issues, 503/429).
_MB_MAX_RETRIES = 3

# Optional HTTPS -> HTTP fallback for DEV ONLY.
# Keep this False for normal usage. If you still hit SSL issues while
# developing locally, you can temporarily flip this to True.
_MB_ALLOW_HTTP_FALLBACK = False


# === Shared HTTP session + rate limiter ====================================

_session = requests.Session()
_session.headers.update(
    {
        "User-Agent": _MB_USER_AGENT,
        "Accept": "application/json",
    }
)

# Timestamp of the last outgoing request (for rate limiting).
_last_request_ts: float = 0.0

logger = get_logger(__name__)
_MB_SOURCE_LOGGED = False


def _sleep_for_rate_limit() -> None:
    """
    Ensure we do not exceed the target average request rate.

    If the last request was less than _MB_MIN_INTERVAL_SEC seconds ago,
    sleep for the remaining time plus a small random jitter.
    """
    global _last_request_ts

    now = time.time()
    elapsed = now - _last_request_ts

    if elapsed < _MB_MIN_INTERVAL_SEC:
        # Remaining time + small jitter to avoid clocked burst patterns.
        to_sleep = (_MB_MIN_INTERVAL_SEC - elapsed) + random.uniform(0.0, 0.25)
        if to_sleep > 0:
            time.sleep(to_sleep)

    _last_request_ts = time.time()


def _log_mb_source_once() -> None:
    global _MB_SOURCE_LOGGED
    if not _MB_SOURCE_LOGGED:
        logger.info("MusicBrainz source: %s", settings.MB_SOURCE)
        _MB_SOURCE_LOGGED = True


def _backoff_delay(attempt: int) -> float:
    """
    Exponential backoff with jitter.

    attempt: 1, 2, 3, ...
    returns: seconds to sleep before next retry.
    """
    base = min(2 ** attempt, 30)  # cap the base at 30 seconds
    jitter = random.uniform(0.0, 1.0)
    return base + jitter


def _request(
    path: str,
    params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Low-level helper to perform a GET request against the MusicBrainz API,
    honoring rate limits and handling transient errors.

    - Sends 'fmt=json' automatically.
    - Handles 503 / 429 with backoff retries.
    - Optionally retries via HTTP (DEV ONLY) when SSL problems occur.

    Raises:
        RuntimeError on repeated failures.
        requests.HTTPError on non-retryable HTTP errors.
    """
    if params is None:
        params = {}

    # MusicBrainz expects 'fmt=json' to get JSON responses.
    params = {**params, "fmt": "json"}

    url = _MB_BASE_URL + path
    last_error: Optional[BaseException] = None

    for attempt in range(1, _MB_MAX_RETRIES + 1):
        _sleep_for_rate_limit()

        # --- Logging: outgoing request ---
        now_str = datetime.datetime.now().isoformat(timespec="seconds")
        logger.info("[MB] REQUEST attempt=%s url=%s params=%s", attempt, url, params)

        try:
            response = _session.get(url, params=params, timeout=10)
        except SSLError as ssl_err:
            last_error = ssl_err

            # Optional HTTPS -> HTTP fallback (DEV ONLY, not for production).
            if _MB_ALLOW_HTTP_FALLBACK:
                try:
                    logger.warning(
                        "MusicBrainz SSL error over HTTPS, retrying over HTTP (DEV ONLY): %r",
                        ssl_err,
                    )
                    http_url = "http://musicbrainz.org/ws/2" + path
                    _sleep_for_rate_limit()
                    response = _session.get(http_url, params=params, timeout=10)
                except RequestException as http_err:
                    last_error = http_err
                    # backoff and retry
                    time.sleep(_backoff_delay(attempt))
                    continue
                # if HTTP fallback succeeded, we drop through to handling below
            else:
                # No HTTP fallback allowed: apply backoff and retry.
                time.sleep(_backoff_delay(attempt))
                continue

        except RequestException as req_err:
            # General network error (DNS, connection reset, etc.)
            last_error = req_err
            time.sleep(_backoff_delay(attempt))
            continue

        # If we got here, we have a response object.

        # --- Logging: incoming response ---
        logger.info("[MB] RESPONSE status=%s url=%s", response.status_code, url)

        # Handle explicit rate limiting / overload responses.
        if response.status_code in (503, 429):
            retry_after = response.headers.get("Retry-After")
            if retry_after is not None:
                try:
                    delay = int(retry_after)
                except ValueError:
                    delay = _backoff_delay(attempt)
            else:
                delay = _backoff_delay(attempt)

            time.sleep(delay)
            continue

        # Raise for other 4xx/5xx errors (non-retryable here).
        try:
            response.raise_for_status()
        except requests.HTTPError as http_err:
            raise http_err

        # Success: parse JSON.
        try:
            return response.json()
        except ValueError as json_err:
            raise RuntimeError(f"Invalid JSON from MusicBrainz: {json_err}") from json_err

    # If we exhausted all retries without returning.
    raise RuntimeError(f"MusicBrainz request failed after {_MB_MAX_RETRIES} attempts: {last_error}")


def _search_artists_api(
    query: str,
    limit: int = 5,
    offset: int = 0,
) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "query": query,
        "limit": limit,
        "offset": offset,
    }
    return _request("/artist", params)


def _search_artists_db(
    query: str,
    limit: int = 5,
    offset: int = 0,
) -> Dict[str, Any]:
    artists = search_artists_by_name_db(query=query, limit=limit, offset=offset)
    return {
        "artists": artists,
        "count": len(artists),
        "offset": offset,
    }


def _get_artist_api(
    mbid: str,
    include_tags: bool = True,
    include_aliases: bool = False,
    include_rels: bool = False,
) -> Dict[str, Any]:
    inc_parts: List[str] = []
    if include_tags:
        inc_parts.append("tags")
    if include_aliases:
        inc_parts.append("aliases")
    if include_rels:
        inc_parts.append("url-rels")
        inc_parts.append("artist-rels")
        inc_parts.append("release-groups")

    params: Dict[str, Any] = {}
    if inc_parts:
        params["inc"] = "+".join(inc_parts)

    return _request(f"/artist/{mbid}", params)


def _get_artist_db(
    mbid: str,
    include_tags: bool = True,
    include_aliases: bool = False,
    include_rels: bool = False,
) -> Dict[str, Any]:
    base = get_artist_by_mbid_db(mbid)
    if base is None:
        raise RuntimeError(f"MusicBrainz artist not found in DB for MBID={mbid}")

    artist: Dict[str, Any] = {
        "id": base.get("id") or mbid,
        "gid": base.get("gid"),
        "mb_internal_id": base.get("mb_internal_id"),
        "name": base.get("name"),
        "sort-name": base.get("sort-name") or base.get("sort_name"),
        "type": base.get("type"),
        "area": base.get("area"),
        "country": base.get("country"),
    }

    if include_aliases:
        artist["aliases"] = []
    if include_tags:
        artist["tags"] = get_artist_tags_db(mbid)
    if include_rels:
        artist["relations"] = []
        artist["release-groups"] = get_artist_release_groups_db(mbid)

    return artist


# === Public API =============================================================

def search_artists(
    query: str,
    limit: int = 5,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    Search for artists by name.
    """
    _log_mb_source_once()
    if settings.MB_SOURCE == "db":
        return _search_artists_db(query=query, limit=limit, offset=offset)
    return _search_artists_api(query=query, limit=limit, offset=offset)


def get_artist(
    mbid: str,
    include_tags: bool = True,
    include_aliases: bool = False,
    include_rels: bool = False,
) -> Dict[str, Any]:
    """
    Fetch detailed information for a single artist by MusicBrainz ID (MBID).
    """
    _log_mb_source_once()
    if settings.MB_SOURCE == "db":
        return _get_artist_db(
            mbid=mbid,
            include_tags=include_tags,
            include_aliases=include_aliases,
            include_rels=include_rels,
        )
    return _get_artist_api(
        mbid=mbid,
        include_tags=include_tags,
        include_aliases=include_aliases,
        include_rels=include_rels,
    )


def search_artist_summary(
    query: Optional[str] = None,
    country_code: str = "DE",
    limit: int = 5,
    offset: int = 0,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Backwards-compatible helper.

    NOTE:
      - Prefer using enrichment.enrich_artist_by_name() in new code.
      - This function exists only to support older imports from main.py.
      - For now, it simply wraps search_artists() and returns the raw JSON
        response from MusicBrainz.

    Args:
        query: Free-text query for artist search.
        country_code: Currently unused here; kept for signature compatibility.
        limit: Max number of results.
        offset: Pagination offset.

    Returns:
        Raw JSON dict from MusicBrainz (same as search_artists()).
    """
    # Accept legacy callers passing `name=...` (e.g., /health/musicbrainz).
    # If both are provided, prefer the canonical `query`.
    final_query = query or name
    if not final_query:
        raise ValueError("search_artist_summary requires a query or name")

    # We ignore country_code here because MusicBrainz doesn't have a
    # direct country filter on this endpoint. Country-based filtering
    # is done higher up (e.g., in enrichment) if needed.
    return search_artists(final_query, limit=limit, offset=offset)
