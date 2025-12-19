"""Spotify album enrichment using the catalog search API (client credentials)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from app.clients.spotify_client import search_spotify_albums_catalog
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Simple in-memory cache: (artist_name, album_name) -> enrichment payload or None
_album_enrichment_cache: Dict[Tuple[str, str], Optional[Dict[str, Any]]] = {}


def _normalize_key(artist_name: str, album_name: str) -> Tuple[str, str]:
    return (artist_name.strip().lower(), album_name.strip().lower())


def _coerce_release_date(release_date: Optional[str], precision: Optional[str]) -> Optional[date]:
    if not release_date:
        return None

    try:
        if precision == "year":
            padded = f"{release_date}-01-01"
        elif precision == "month":
            padded = f"{release_date}-01"
        else:
            padded = release_date
        return datetime.strptime(padded, "%Y-%m-%d").date()
    except Exception:
        return None


def _choose_latest_album(items: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Optional[date]]:
    best_item: Optional[Dict[str, Any]] = None
    best_date: Optional[date] = None

    for item in items:
        release_date = item.get("release_date")
        precision = item.get("release_date_precision")
        parsed_date = _coerce_release_date(release_date, precision)

        if parsed_date is None and best_item is None:
            best_item = item
            continue

        if parsed_date is not None and (best_date is None or parsed_date > best_date):
            best_date = parsed_date
            best_item = item

    return best_item, best_date


def enrich_album_from_spotify(
    artist_name: str,
    album_name: str,
) -> Optional[Dict[str, Any]]:
    """
    Enrich a single album using Spotify catalog search.

    Returns a payload with spotify_* fields or None if nothing matched.
    """
    key = _normalize_key(artist_name, album_name)
    if key in _album_enrichment_cache:
        return _album_enrichment_cache[key]

    items = search_spotify_albums_catalog(album_name=album_name, artist_name=artist_name, limit=10, market="DE")
    if not items:
        _album_enrichment_cache[key] = None
        return None

    chosen, parsed_date = _choose_latest_album(items)
    if not chosen:
        _album_enrichment_cache[key] = None
        return None

    images = chosen.get("images") or []
    external_urls = chosen.get("external_urls") or {}
    release_date = chosen.get("release_date")
    precision = chosen.get("release_date_precision")

    payload = {
        "spotify_album_id": chosen.get("id"),
        "spotify_url": external_urls.get("spotify"),
        "spotify_image_url": images[0]["url"] if images else None,
        "spotify_album_name": chosen.get("name"),
        "spotify_release_date": release_date,
        "spotify_release_date_precision": precision,
    }

    logger.info(
        "[spotify-enrich] matched '%s' by '%s' -> '%s' (%s precision=%s)",
        album_name,
        artist_name,
        payload.get("spotify_album_name"),
        release_date,
        precision,
    )

    _album_enrichment_cache[key] = payload
    return payload


def enrich_albums_with_spotify(
    rows: List[Dict[str, Any]],
    enrich_spotify: bool = True,
    max_items: int = 50,
) -> List[Dict[str, Any]]:
    """
    Mutates the provided rows to add spotify_* fields when enrichment is enabled.
    """
    if not enrich_spotify or not rows:
        return rows

    limit = min(max_items, len(rows))
    for idx in range(limit):
        row = rows[idx]
        artist_name = (row.get("artist_name") or "").strip()
        album_name = (row.get("release_group_name") or "").strip()

        if not artist_name or not album_name:
            continue

        try:
            enrichment = enrich_album_from_spotify(artist_name=artist_name, album_name=album_name)
        except Exception as exc:  # noqa: BLE001 - fail-soft
            logger.info("[spotify-enrich] failed for %r / %r: %s", album_name, artist_name, exc)
            continue

        if enrichment:
            row.update(enrichment)

    return rows
