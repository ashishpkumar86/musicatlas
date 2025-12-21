"""Taste profile endpoint: clusters + bucketed album recs."""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

from app.clients.spotify_client import (
    SpotifyAPIError,
    get_spotify_top_artists,
    simplify_spotify_artist,
)
from app.data.musicbrainz_db import (
    fetch_artist_primary_clusters,
    fetch_cluster_labels,
    fetch_user_top_clusters,
)
from app.services.spotify_enrichment import enrich_albums_with_spotify
from app.routers.auth import get_current_session
from app.routers.recs import SimpleArtist, resolve_mb_artists_from_spotify, run_album_recs_query
from app.utils.config import SESSION_COOKIE_NAME, SESSIONS
from app.utils.logging import get_logger
from app.utils.session import ensure_session_defaults

router = APIRouter()
logger = get_logger(__name__)

DEFAULT_RECS = 50
STRONG_THRESHOLD = 20
MODERATE_THRESHOLD = 10
MIN_CLUSTER_SHARE = 0.03
CUM_SHARE_TARGET = 0.85
TASTE_ENRICH_MAX_ITEMS = 25


def _strength_label(album_count: int) -> str:
    if album_count >= STRONG_THRESHOLD:
        return "Strong"
    if album_count >= MODERATE_THRESHOLD:
        return "Moderate"
    return "Weak"


def _dedup_ordered(items: List[int]) -> List[int]:
    seen = set()
    ordered: List[int] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


@router.get("/profile")
def taste_profile(request: Request, validate: bool = False):
    """
    Deterministic taste buckets based on cluster/tag profiles and Spotify genres.
    """
    try:
        session = get_current_session(request)
    except HTTPException:
        raise HTTPException(status_code=401, detail="Not logged in (no session cookie)")

    user_id = session.get("spotify_user_id")
    access_token = session.get("spotify_access_token")
    if not user_id or not access_token:
        raise HTTPException(status_code=401, detail="Not logged in with Spotify")

    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    session_store: Optional[Dict[str, Any]] = None
    if session_id:
        session_store = ensure_session_defaults(session_id)

    albums = []
    if session_store:
        albums = session_store.get("album_recs") or []

    # Fetch fresh recs if none cached
    if len(albums) < DEFAULT_RECS:
        try:
            items = get_spotify_top_artists(access_token=access_token, limit=DEFAULT_RECS, time_range="medium_term")
            simplified = [simplify_spotify_artist(a) for a in items]
            simple_artists = [
                SimpleArtist(name=s.get("name"), popularity=s.get("popularity"), genres=s.get("genres") or [])
                for s in simplified
                if s.get("name")
            ]
            seeds_raw, _, _ = resolve_mb_artists_from_spotify(simple_artists)
            seeds = _dedup_ordered(seeds_raw)
        except SpotifyAPIError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Spotify seed ingestion failed: {exc}")

        if not seeds:
            raise HTTPException(status_code=400, detail="No MusicBrainz artist IDs resolved from Spotify seeds")

        albums = run_album_recs_query(
            seeds=seeds,
            k=DEFAULT_RECS,
            window_years=1,
            min_tracks=3,
            max_per_tag=2,
        )
        # Limit Spotify catalog calls to keep the response under proxy timeouts.
        albums = enrich_albums_with_spotify(albums, enrich_spotify=True, max_items=TASTE_ENRICH_MAX_ITEMS)

        if session_store is not None:
            session_store["album_recs"] = albums
            SESSIONS[session_id] = session_store

    # User cluster weights
    all_clusters = fetch_user_top_clusters(user_id=user_id, top_n=50)
    if not all_clusters:
        raise HTTPException(status_code=404, detail="No taste clusters found for user")

    total_weight = sum(float(c.get("weight") or 0) for c in all_clusters)
    if total_weight <= 0:
        raise HTTPException(status_code=404, detail="No taste clusters found for user (zero weight)")

    included: List[Dict[str, Any]] = []
    cum_share = 0.0
    min_included_share = None
    for cluster in all_clusters:
        weight = float(cluster.get("weight") or 0)
        weight_share = weight / total_weight if total_weight else 0.0
        if weight_share < MIN_CLUSTER_SHARE:
            continue
        included.append({**cluster, "weight_share": weight_share})
        cum_share += weight_share
        min_included_share = weight_share if min_included_share is None else min(min_included_share, weight_share)
        if cum_share >= CUM_SHARE_TARGET:
            break

    if not included:
        raise HTTPException(status_code=404, detail="No taste clusters met inclusion thresholds")

    cluster_ids = [int(c["cluster_id"]) for c in included]
    cluster_labels = fetch_cluster_labels(cluster_ids)

    artist_ids = [row.get("artist_id") for row in albums if isinstance(row.get("artist_id"), int)]
    cluster_map = fetch_artist_primary_clusters(artist_ids)

    buckets: Dict[Any, Dict[str, Any]] = {}
    # Initialize buckets for included clusters
    for cluster in included:
        cid = int(cluster["cluster_id"])
        label_info = cluster_labels.get(cid, {})
        buckets[cid] = {
            "cluster_id": cid,
            "label_primary": label_info.get("label_primary") or f"Cluster {cid}",
            "label_secondary": label_info.get("label_secondary"),
            "top_spotify_genres": label_info.get("top_spotify_genres") or [],
            "weight": cluster.get("weight"),
            "weight_share": cluster.get("weight_share"),
            "albums": [],
        }

    buckets["other"] = {
        "cluster_id": None,
        "label_primary": "Other",
        "label_secondary": None,
        "top_spotify_genres": [],
        "albums": [],
    }

    for album in albums:
        artist_id = album.get("artist_id")
        if isinstance(artist_id, int) and artist_id in cluster_map:
            cid = int(cluster_map[artist_id]["cluster_id"])
        else:
            cid = "other"

        bucket_key = cid if cid in buckets else "other"
        buckets[bucket_key]["albums"].append(album)

    # Compute strengths and output order
    ordered_bucket_keys = [int(c["cluster_id"]) for c in included if c.get("cluster_id") in buckets] + ["other"]
    result_buckets = []
    hidden_zero_album_bucket_count = 0
    for key in ordered_bucket_keys:
        bucket = buckets.get(key)
        if not bucket:
            continue
        count = len(bucket["albums"])
        bucket["album_count"] = count
        if bucket["cluster_id"] is not None:
            if count == 0:
                hidden_zero_album_bucket_count += 1
                continue
            bucket["strength"] = _strength_label(count)
        else:
            if count == 0:
                continue  # hide Other if empty
        result_buckets.append(bucket)

    validation: Optional[Dict[str, Any]] = None
    if validate:
        validation = {
            "bucket_count": len(result_buckets),
            "album_total": sum(len(b["albums"]) for b in result_buckets),
            "has_other": any(b.get("cluster_id") is None for b in result_buckets),
            "ok": sum(len(b["albums"]) for b in result_buckets) == len(albums),
            "included_cluster_count": len(included),
            "taste_cluster_count": len(included),
            "displayed_bucket_count": len([b for b in result_buckets if b.get("cluster_id") is not None]),
            "hidden_zero_album_bucket_count": hidden_zero_album_bucket_count,
            "cum_share_final": round(cum_share, 4),
            "min_weight_share_included": round(min_included_share, 4) if min_included_share is not None else None,
            "total_weight": total_weight,
        }

    return {
        "user_id": user_id,
        "buckets": result_buckets,
        "top_clusters": included,
        "taste_clusters": included,
        "total_albums": len(albums),
        "validation": validation,
    }
