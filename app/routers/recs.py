"""Album recommendation endpoints backed by DB function calls."""

from typing import List
import re

from fastapi import APIRouter, HTTPException, Request
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

from app.data.musicbrainz_db import get_mb_connection
from app.services.sonic_tags import fetch_musicbrainz_artist_full
from app.services.spotify_enrichment import enrich_albums_with_spotify
from app.utils.config import SESSION_COOKIE_NAME, SESSIONS
from app.utils.session import ensure_session_defaults
from app.utils.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


def _parse_seed_ids(seed_param: str | None) -> List[int]:
    if not seed_param:
        raise HTTPException(status_code=400, detail="seeds is required and must be non-empty")

    # Allow comma or whitespace separated values and optional brackets.
    cleaned = seed_param.strip().strip("[]")
    tokens = [tok for tok in re.split(r"[,\s]+", cleaned) if tok]
    if not tokens:
        raise HTTPException(status_code=400, detail="seeds must contain at least one integer")

    try:
        seed_ids = [int(tok) for tok in tokens]
    except ValueError:
        raise HTTPException(status_code=400, detail="seeds must be integers")

    return seed_ids


class SimpleArtist(BaseModel):
    name: str
    popularity: int | None = None
    genres: List[str] | None = None


class AddArtistPayload(BaseModel):
    name: str


@router.get("/albums")
def get_album_recommendations(
    seeds: str,
    k: int = 50,
    window_years: int = 1,
    min_tracks: int = 3,
    max_per_tag: int = 2,
    enrich_spotify: bool = True,
):
    """
    Proxy to the DB function public.get_album_recs_v1.
    """
    seed_ids = _parse_seed_ids(seeds)

    query = """
    SELECT *
    FROM public.get_album_recs_v1(
      %s::int[],
      %s::int,
      %s::int,
      %s::int,
      %s::int
    );
    """

    try:
        conn = get_mb_connection()
    except Exception as exc:
        logger.error("DB connection error: %s", exc)
        raise HTTPException(status_code=500, detail="Database connection error")

    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    query,
                    (seed_ids, k, window_years, min_tracks, max_per_tag),
                )
                rows = cur.fetchall()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("DB error executing get_album_recs_v1: %s", exc)
        raise HTTPException(status_code=500, detail="Database error during album recommendation")
    finally:
        conn.close()

    rows = enrich_albums_with_spotify(rows, enrich_spotify=enrich_spotify, max_items=50)
    return rows


@router.post("/albums/from-spotify")
def get_album_recommendations_from_spotify(
    request: Request,
    artists: List[SimpleArtist],
    k: int = 50,
    window_years: int = 1,
    min_tracks: int = 3,
    max_per_tag: int = 2,
    enrich_spotify: bool = True,
):
    """
    Map Spotify artists to MusicBrainz numeric IDs, then call get_album_recs_v1.
    """
    if not artists:
        raise HTTPException(status_code=400, detail="artists list cannot be empty")

    logger.info("[RECS] from-spotify received %d artists", len(artists))

    mb_numeric_ids: List[int] = []
    for artist in artists:
        try:
            mb_artist = fetch_musicbrainz_artist_full(artist.name)
        except Exception as exc:  # noqa: BLE001 - surface errors
            logger.warning("MB lookup failed for '%s': %s", artist.name, exc)
            continue

        if not mb_artist:
            continue

        internal_id = mb_artist.get("mb_internal_id")
        if isinstance(internal_id, int):
            mb_numeric_ids.append(internal_id)

    # Dedup while preserving order
    seen = set()
    seeds_ordered: List[int] = []
    for sid in mb_numeric_ids:
        if sid in seen:
            continue
        seen.add(sid)
        seeds_ordered.append(sid)

    logger.info("[RECS] resolved %d seeds (unique)", len(seeds_ordered))

    if not seeds_ordered:
        raise HTTPException(status_code=400, detail="No MusicBrainz artist IDs resolved from input artists")

    query = """
    SELECT *
    FROM public.get_album_recs_v1(
      %s::int[],
      %s::int,
      %s::int,
      %s::int,
      %s::int
    );
    """

    try:
        conn = get_mb_connection()
    except Exception as exc:
        logger.error("DB connection error: %s", exc)
        raise HTTPException(status_code=500, detail="Database connection error")

    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    query,
                    (seeds_ordered, k, window_years, min_tracks, max_per_tag),
                )
                rows = cur.fetchall()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("DB error executing get_album_recs_v1: %s", exc)
        raise HTTPException(status_code=500, detail="Database error during album recommendation")
    finally:
        conn.close()

    rows = enrich_albums_with_spotify(rows, enrich_spotify=enrich_spotify, max_items=50)

    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        session = ensure_session_defaults(session_id)
        session["album_recs"] = rows
        SESSIONS[session_id] = session

    return rows


@router.post("/albums/add-artist")
def get_album_recommendations_for_added_artist(
    request: Request,
    payload: AddArtistPayload,
    k: int = 50,
    window_years: int = 1,
    min_tracks: int = 3,
    max_per_tag: int = 2,
    enrich_spotify: bool = True,
):
    """
    Resolve a single artist name to a MusicBrainz numeric ID and fetch album recs.
    """
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="artist name cannot be empty")

    mb_artist = fetch_musicbrainz_artist_full(name)
    if not mb_artist or not isinstance(mb_artist.get("mb_internal_id"), int):
        raise HTTPException(status_code=404, detail="Artist not found in DB")

    seed_ids = [mb_artist["mb_internal_id"]]

    query = """
    SELECT *
    FROM public.get_album_recs_v1(
      %s::int[],
      %s::int,
      %s::int,
      %s::int,
      %s::int
    );
    """

    try:
        conn = get_mb_connection()
    except Exception as exc:
        logger.error("DB connection error: %s", exc)
        raise HTTPException(status_code=500, detail="Database connection error")

    try:
        with conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    query,
                    (seed_ids, k, window_years, min_tracks, max_per_tag),
                )
                rows = cur.fetchall()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("DB error executing get_album_recs_v1 (add-artist): %s", exc)
        raise HTTPException(status_code=500, detail="Database error during album recommendation")
    finally:
        conn.close()

    rows = enrich_albums_with_spotify(rows, enrich_spotify=enrich_spotify, max_items=50)

    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        session = ensure_session_defaults(session_id)
        session["album_recs"] = rows
        SESSIONS[session_id] = session

    return rows
