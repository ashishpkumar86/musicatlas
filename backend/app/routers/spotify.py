"""Spotify-related routes."""

from fastapi import APIRouter, HTTPException, Request

from app.clients.spotify_client import (
    SpotifyAPIError,
    get_spotify_artist,
    get_spotify_top_artists,
    simplify_spotify_artist,
)
from app.routers.auth import get_current_session

router = APIRouter()


@router.get("/top-artists")
def spotify_top_artists(
    request: Request,
    limit: int = 20,
    time_range: str = "medium_term",
):
    """
    Return the current user's Spotify top artists (our 'favorites' analogue).
    """
    try:
        session = get_current_session(request)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Not logged in (no session cookie)")

    access_token = session.get("spotify_access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Not logged in with Spotify")

    try:
        items = get_spotify_top_artists(
            access_token=access_token,
            limit=limit,
            time_range=time_range,
        )
        simplified = [simplify_spotify_artist(a) for a in items]
    except SpotifyAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Spotify top artists error: {e}")

    return {"items": simplified}


@router.get("/artist/{artist_id}")
def spotify_artist_detail(request: Request, artist_id: str):
    """
    Fetch detailed Spotify artist info (includes followers, genres, popularity).
    """
    try:
        session = get_current_session(request)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Not logged in (no session cookie)")

    access_token = session.get("spotify_access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Not logged in with Spotify")

    try:
        artist = get_spotify_artist(access_token=access_token, artist_id=artist_id)
        return simplify_spotify_artist(artist)
    except SpotifyAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Spotify artist error: {e}")
