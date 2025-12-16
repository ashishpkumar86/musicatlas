"""TIDAL-related API routes."""

import requests
from fastapi import APIRouter, HTTPException, Request

from app.clients.tidal_client import (
    TidalAPIError,
    get_artist_raw,
    get_artist_summary,
    get_artist_details,
    get_user_favorite_artists,
    search_artist_raw,
)
from app.routers.auth import get_current_session
from app.utils.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)


@router.get("/favorites/artists")
def tidal_favorite_artists(
    request: Request,
    limit: int = 50,
    offset: int = 0,
):
    """
    Return the current user's favorite artists from TIDAL.
    """
    session = get_current_session(request)

    access_token = session["access_token"]
    user_id = session["user_id"]
    country_code = "DE"

    try:
        raw = get_user_favorite_artists(
            access_token=access_token,
            user_id=str(user_id),
            country_code=country_code,
            limit=limit,
            offset=offset,
        )
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"TIDAL favorites HTTP error: {e.response.status_code} {e.response.text}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"TIDAL favorites error: {e}",
        )

    try:
        data_entries = raw.get("data") or []

        sorted_entries = sorted(
            data_entries,
            key=lambda x: (x.get("meta") or {}).get("addedAt", ""),
            reverse=True,
        )

        top_entries = sorted_entries[:5]
        top_ids = {
            str(entry.get("id"))
            for entry in top_entries
            if entry.get("id") is not None
        }

        included = raw.get("included") or []
        if not isinstance(included, list):
            return raw

        for item in included:
            if item.get("type") != "artists":
                continue

            artist_id = str(item.get("id"))
            if artist_id not in top_ids:
                continue

            attrs = item.get("attributes") or {}
            if attrs.get("imageUrl"):
                continue

            try:
                summary = get_artist_summary(artist_id, country_code=country_code)
                image_url = summary.get("imageUrl")
                if image_url:
                    attrs["imageUrl"] = image_url
                    item["attributes"] = attrs

            except TidalAPIError as exc:
                logger.error("[TIDAL FAVORITES ENRICH] artist_id=%s error=%s", artist_id, exc)
                continue

            except requests.HTTPError as http_err:
                status = http_err.response.status_code if http_err.response else None
                logger.error(
                    "TIDAL artist error status=%s body=%s",
                    status,
                    getattr(http_err.response, "text", ""),
                )

                if status == 429:
                    logger.warning("[TIDAL FAVORITES ENRICH] hit rate limit, stopping enrichment loop")
                    break

            except Exception as exc:
                logger.error("[TIDAL FAVORITES ENRICH] artist_id=%s error=%s", artist_id, exc)

        raw["included"] = included

    except Exception as exc:
        logger.error("[TIDAL FAVORITES ENRICH] outer error: %s", exc)

    return raw


@router.get("/artist/{artist_id}")
def tidal_artist_raw(artist_id: str, country_code: str = "DE"):
    """
    Raw OpenAPI v2 TIDAL artist JSON.
    """
    try:
        return get_artist_raw(artist_id, country_code)
    except TidalAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"TIDAL error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/artist/{artist_id}/summary")
def tidal_artist_summary(artist_id: str, country_code: str = "DE"):
    """
    Clean, frontend-friendly summary of a TIDAL artist.
    """
    try:
        return get_artist_summary(artist_id, country_code)
    except TidalAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"TIDAL error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@router.get("/artist/{artist_id}/details")
def tidal_artist_details(artist_id: str, country_code: str = "DE"):
    """
    Detailed TIDAL artist info: popularity plus follower relationship metadata.
    """
    try:
        raw = get_artist_details(
            artist_id=artist_id,
            country_code=country_code,
            include_followers=True,
        )
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"TIDAL error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")

    data = raw.get("data") or {}
    attrs = data.get("attributes") or {}
    relationships = data.get("relationships") or {}
    followers_rel = relationships.get("followers") or {}
    followers_data = followers_rel.get("data")
    followers_count = len(followers_data) if isinstance(followers_data, list) else None

    return {
        "id": data.get("id"),
        "name": attrs.get("name"),
        "popularity": attrs.get("popularity"),
        "followers_count": followers_count,
    }


@router.get("/search/artist")
def tidal_search_artist(
    query: str,
    country_code: str = "DE",
    limit: int = 10,
    offset: int = 0,
):
    """
    Raw TIDAL search. This may return 404 if your TIDAL developer app
    does NOT have catalog search API entitlements.
    """
    try:
        return search_artist_raw(query, country_code, limit, offset)
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=e.response.status_code if e.response else 502,
            detail=f"TIDAL error: {e}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")
