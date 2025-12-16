"""MusicBrainz routes."""

import requests
from fastapi import APIRouter, HTTPException

from app.clients.musicbrainz_client import (
    get_artist as mb_get_artist,
    search_artist_summary as mb_search_artist_summary,
    search_artists as mb_search_artist,
)
from app.services.sonic_tags import extract_tags_from_mb_artist, fetch_musicbrainz_artist_full

router = APIRouter()


@router.get("/artist/search")
def mb_artist_search(name: str, limit: int = 5, offset: int = 0):
    """
    Raw MusicBrainz artist search.
    """
    try:
        return mb_search_artist(name=name, limit=limit, offset=offset)
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"MusicBrainz error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/artist/search/summary")
def mb_artist_search_summary(name: str, limit: int = 5):
    """
    Simplified list of candidate artists for a given name.
    """
    try:
        return mb_search_artist_summary(name=name, limit=limit)
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"MusicBrainz error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/artist/{mbid}")
def mb_artist(mbid: str):
    """
    Detailed MusicBrainz artist by MBID, including tags, relationships, etc.
    """
    try:
        return mb_get_artist(mbid)
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"MusicBrainz error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/artist/enriched/by-name")
def mb_artist_enriched(name: str, country_code: str | None = None):
    """
    Lightweight enriched lookup against MusicBrainz by name.
    """
    artist = fetch_musicbrainz_artist_full(name, country_code=country_code)
    if not artist:
        raise HTTPException(status_code=404, detail="Not Found")

    return {
        "name": artist.get("name", name),
        "country": artist.get("country"),
        "tags": extract_tags_from_mb_artist(artist),
    }

