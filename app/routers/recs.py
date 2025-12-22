"""Album recommendation endpoints backed by DB function calls."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from threading import Lock
from typing import List, Dict, Any
from uuid import uuid4
import re
import time

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from fastapi.responses import JSONResponse
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

from app.data.musicbrainz_db import (
    get_mb_connection,
    upsert_artist_spotify_genres,
)
from app.services.sonic_tags import fetch_musicbrainz_artist_full
from app.services.spotify_enrichment import enrich_albums_with_spotify
from app.utils.config import SESSION_COOKIE_NAME, SESSIONS
from app.utils.session import ensure_session_defaults
from app.utils.logging import get_logger

router = APIRouter()
logger = get_logger(__name__)

JOB_TTL_MINUTES = 60


@dataclass
class JobProgress:
    stage: str = "queued"
    counts: Dict[str, int] = field(default_factory=dict)


@dataclass
class Job:
    id: str
    status: str = "queued"
    progress: JobProgress = field(default_factory=JobProgress)
    result: Any = None
    error: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)
    expires_at: datetime = field(
        default_factory=lambda: datetime.utcnow() + timedelta(minutes=JOB_TTL_MINUTES)
    )


JOB_REGISTRY: Dict[str, Job] = {}
JOB_LOCK = Lock()


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


def run_album_recs_query(
    seeds: List[int],
    k: int,
    window_years: int,
    min_tracks: int,
    max_per_tag: int,
) -> List[Dict[str, Any]]:
    """
    Shared executor for public.get_album_recs_v1.
    """
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
                    (seeds, k, window_years, min_tracks, max_per_tag),
                )
                return list(cur.fetchall() or [])
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("DB error executing get_album_recs_v1: %s", exc)
        raise HTTPException(status_code=500, detail="Database error during album recommendation")
    finally:
        conn.close()


def resolve_mb_artists_from_spotify(artists: List[SimpleArtist]) -> tuple[list[int], list[str], list[str]]:
    """
    Resolve Spotify artists to MusicBrainz internal IDs and persist their Spotify genres.

    Returns:
        seeds_ordered: list of resolved MB artist_ids (may contain duplicates for logging)
        resolved_names: names that resolved
        missed_names: names that missed
    """
    mb_numeric_ids: List[int] = []
    resolved_names: List[str] = []
    missed_names: List[str] = []

    for artist in artists:
        t0 = time.time()
        try:
            mb_artist = fetch_musicbrainz_artist_full(artist.name)
        except Exception as exc:  # noqa: BLE001 - surface errors
            logger.warning("MB lookup failed for '%s': %s", artist.name, exc)
            continue

        if not mb_artist:
            missed_names.append(artist.name)
            continue

        internal_id = mb_artist.get("mb_internal_id")
        if isinstance(internal_id, int):
            mb_numeric_ids.append(internal_id)
            resolved_names.append(artist.name)
            try:
                upsert_artist_spotify_genres(internal_id, artist.genres or [])
            except Exception as exc:  # noqa: BLE001 - best-effort
                logger.info("Failed to upsert Spotify genres for %s (%s): %s", artist.name, internal_id, exc)
        else:
            missed_names.append(artist.name)

        logger.debug(
            "[RECS] MB lookup %.3fs for '%s' -> %s",
            time.time() - t0,
            artist.name,
            "hit" if mb_artist else "miss",
        )

    return mb_numeric_ids, resolved_names, missed_names


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

    rows = run_album_recs_query(
        seeds=seed_ids,
        k=k,
        window_years=window_years,
        min_tracks=min_tracks,
        max_per_tag=max_per_tag,
    )

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

    mb_numeric_ids, resolved_names, missed_names = resolve_mb_artists_from_spotify(artists)

    # Dedup while preserving order
    seen = set()
    seeds_ordered: List[int] = []
    for sid in mb_numeric_ids:
        if sid in seen:
            continue
        seen.add(sid)
        seeds_ordered.append(sid)

    logger.info(
        "[RECS] resolved %d/%d seeds (unique=%d) sample=%s missed=%d",
        len(resolved_names),
        len(artists),
        len(seeds_ordered),
        resolved_names[:5],
        len(missed_names),
    )

    if not seeds_ordered:
        raise HTTPException(status_code=400, detail="No MusicBrainz artist IDs resolved from input artists")

    rows = run_album_recs_query(
        seeds=seeds_ordered,
        k=k,
        window_years=window_years,
        min_tracks=min_tracks,
        max_per_tag=max_per_tag,
    )

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

    rows = run_album_recs_query(
        seeds=seed_ids,
        k=k,
        window_years=window_years,
        min_tracks=min_tracks,
        max_per_tag=max_per_tag,
    )

    rows = enrich_albums_with_spotify(rows, enrich_spotify=enrich_spotify, max_items=50)

    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        session = ensure_session_defaults(session_id)
        session["album_recs"] = rows
        SESSIONS[session_id] = session

    return rows


def _cleanup_expired_jobs() -> None:
    """
    Remove expired jobs to keep memory bounded.
    """
    now = datetime.utcnow()
    with JOB_LOCK:
        to_delete = [job_id for job_id, job in JOB_REGISTRY.items() if job.expires_at <= now]
        for job_id in to_delete:
            JOB_REGISTRY.pop(job_id, None)


def _get_job(job_id: str) -> Job:
    _cleanup_expired_jobs()
    with JOB_LOCK:
        job = JOB_REGISTRY.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _store_job(job: Job) -> None:
    job.updated_at = datetime.utcnow()
    job.expires_at = datetime.utcnow() + timedelta(minutes=JOB_TTL_MINUTES)
    with JOB_LOCK:
        JOB_REGISTRY[job.id] = job


def _update_job_progress(job_id: str, stage: str, counts: Dict[str, int] | None = None) -> None:
    with JOB_LOCK:
        job = JOB_REGISTRY.get(job_id)
        if not job:
            return
        job.progress = JobProgress(stage=stage, counts=counts or {})
        job.updated_at = datetime.utcnow()
        job.expires_at = datetime.utcnow() + timedelta(minutes=JOB_TTL_MINUTES)
        JOB_REGISTRY[job_id] = job
    logger.info("[RECS JOB] %s stage=%s counts=%s", job_id, stage, counts or {})


def _mark_job_error(job_id: str, message: str) -> None:
    with JOB_LOCK:
        job = JOB_REGISTRY.get(job_id)
        if not job:
            return
        job.status = "error"
        job.error = message
        job.progress = JobProgress(stage="error")
        job.updated_at = datetime.utcnow()
        job.expires_at = datetime.utcnow() + timedelta(minutes=JOB_TTL_MINUTES)
        JOB_REGISTRY[job_id] = job


def run_recs_job(
    job_id: str,
    artists: List[SimpleArtist],
    session_id: str | None,
    k: int,
    window_years: int,
    min_tracks: int,
    max_per_tag: int,
    enrich_spotify: bool,
) -> None:
    """
    Background executor for album recommendations.
    """
    with JOB_LOCK:
        job = JOB_REGISTRY.get(job_id)
        if not job:
            return
        job.status = "running"
        job.updated_at = datetime.utcnow()
        job.progress = JobProgress(stage="resolving_seeds")
        JOB_REGISTRY[job_id] = job
    logger.info("[RECS JOB] started job_id=%s artists=%d", job_id, len(artists))

    try:
        _update_job_progress(job_id, "resolving_seeds", {"artists": len(artists)})
        mb_numeric_ids, resolved_names, missed_names = resolve_mb_artists_from_spotify(artists)

        # Dedup while preserving order
        seen = set()
        seeds_ordered: List[int] = []
        for sid in mb_numeric_ids:
            if sid in seen:
                continue
            seen.add(sid)
            seeds_ordered.append(sid)

        _update_job_progress(
            job_id,
            "resolved",
            {"resolved": len(resolved_names), "missed": len(missed_names), "unique_seeds": len(seeds_ordered)},
        )

        if not seeds_ordered:
            raise HTTPException(status_code=400, detail="No MusicBrainz artist IDs resolved from input artists")

        _update_job_progress(job_id, "fetching_recs", {"seeds": len(seeds_ordered)})
        rows = run_album_recs_query(
            seeds=seeds_ordered,
            k=k,
            window_years=window_years,
            min_tracks=min_tracks,
            max_per_tag=max_per_tag,
        )

        _update_job_progress(job_id, "enriching_spotify", {"albums": len(rows)})
        rows = enrich_albums_with_spotify(rows, enrich_spotify=enrich_spotify, max_items=50)

        if session_id:
            session = ensure_session_defaults(session_id)
            session["album_recs"] = rows
            SESSIONS[session_id] = session

        with JOB_LOCK:
            job = JOB_REGISTRY.get(job_id)
            if not job:
                return
            job.status = "done"
            job.result = rows
            job.progress = JobProgress(stage="done", counts={"albums": len(rows)})
            job.updated_at = datetime.utcnow()
            job.expires_at = datetime.utcnow() + timedelta(minutes=JOB_TTL_MINUTES)
            JOB_REGISTRY[job_id] = job
        logger.info("[RECS JOB] completed job_id=%s recs=%d", job_id, len(rows))
    except HTTPException as exc:
        _mark_job_error(job_id, exc.detail if isinstance(exc.detail, str) else str(exc.detail))
        logger.warning("[RECS JOB] job_id=%s failed: %s", job_id, exc)
    except Exception as exc:  # noqa: BLE001 - surface errors
        _mark_job_error(job_id, str(exc))
        logger.exception("[RECS JOB] job_id=%s unexpected failure", job_id)


@router.post("/jobs", status_code=status.HTTP_202_ACCEPTED)
def create_recs_job(
    request: Request,
    background_tasks: BackgroundTasks,
    artists: List[SimpleArtist],
    k: int = 50,
    window_years: int = 1,
    min_tracks: int = 3,
    max_per_tag: int = 2,
    enrich_spotify: bool = True,
):
    """
    Create a recommendation job and start processing in the background.
    """
    if not artists:
        raise HTTPException(status_code=400, detail="artists list cannot be empty")

    _cleanup_expired_jobs()
    job_id = str(uuid4())
    job = Job(id=job_id)
    _store_job(job)
    logger.info("[RECS JOB] created job_id=%s", job_id)

    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    background_tasks.add_task(
        run_recs_job,
        job_id,
        artists,
        session_id,
        k,
        window_years,
        min_tracks,
        max_per_tag,
        enrich_spotify,
    )

    return {
        "job_id": job_id,
        "status": job.status,
        "progress": {"stage": job.progress.stage, "counts": job.progress.counts},
        "status_url": f"/recs/jobs/{job_id}",
        "result_url": f"/recs/jobs/{job_id}/result",
    }


@router.get("/jobs/{job_id}")
def get_recs_job_status(job_id: str):
    """
    Lightweight status endpoint for recommendation jobs.
    """
    job = _get_job(job_id)
    return {
        "job_id": job.id,
        "status": job.status,
        "progress": {"stage": job.progress.stage, "counts": job.progress.counts},
        "error": job.error,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "expires_at": job.expires_at.isoformat(),
    }


@router.get("/jobs/{job_id}/result")
def get_recs_job_result(job_id: str):
    """
    Return the final job payload when ready; otherwise signal in-progress.
    """
    job = _get_job(job_id)
    if job.status == "done":
        return job.result
    if job.status == "error":
        raise HTTPException(status_code=500, detail=job.error or "Job failed")
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "job_id": job.id,
            "status": job.status,
            "progress": {"stage": job.progress.stage, "counts": job.progress.counts},
            "detail": "Job not finished",
        },
    )
