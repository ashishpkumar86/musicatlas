"""Enrichment-related routes and helpers."""

from typing import List

from fastapi import APIRouter, HTTPException, Request

from app.routers.auth import get_current_session
from app.models.artist_inputs import UserArtistInput
from app.services.enrichment_service import enrich_artist_by_name
from app.services.sonic_tags import build_user_sonic_tags, build_user_sonic_tags_from_mbids
from app.utils.config import SESSION_COOKIE_NAME
from app.utils.session import get_session_mb_artist_mbids, set_session_mb_artist_mbids

# Routes that should live under /user prefix (e.g., /user/sonic-tags).
router = APIRouter()

# Public enrichment routes (no prefix).
public_router = APIRouter()


@public_router.get("/artist/by-name")
def artist_by_name(name: str, country_code: str = "DE"):
    """
    Enriched artist lookup by name.
    """
    result = enrich_artist_by_name(name, country_code)
    if result is None:
        raise HTTPException(status_code=404, detail="Artist not found in stub")

    return result


@router.post("/sonic-tags")
def build_user_sonic_tags_route(request: Request, artists: List[UserArtistInput]):
    """
    Build a user-level tag cloud + canonical artist list from a list of input artists.
    """
    get_current_session(request)
    session_id = request.cookies.get(SESSION_COOKIE_NAME)

    if session_id:
        mbids = get_session_mb_artist_mbids(session_id)
        if mbids:
            try:
                return build_user_sonic_tags_from_mbids(mbids)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))

    try:
        result = build_user_sonic_tags(artists)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if session_id:
        mbids = [
            artist.get("mbid")
            for artist in result.get("canonical_artists", [])
            if artist.get("mbid")
        ]
        deduped_mbids = [mbid for mbid in dict.fromkeys(mbids)]
        set_session_mb_artist_mbids(session_id, deduped_mbids)

    return result
