"""Synchronous MusicBrainz DB helpers (PostgreSQL)."""

from typing import Any, Dict, List, Optional, Sequence

import psycopg2
from psycopg2.extras import RealDictCursor

from app.config import settings
from app.utils.logging import get_logger

logger = get_logger(__name__)


def get_mb_connection():
    """
    Open a new MusicBrainz DB connection using MB_DATABASE_URL.
    """
    if not settings.MB_DATABASE_URL:
        raise RuntimeError("MB_DATABASE_URL is not set but MB_SOURCE='db'")
    conn = psycopg2.connect(settings.MB_DATABASE_URL, cursor_factory=RealDictCursor)
    # Avoid indefinitely hanging queries; default to 8s unless overridden via env.
    timeout_ms = max(int(getattr(settings, "MB_DB_STATEMENT_TIMEOUT_MS", 8000) or 0), 0)
    if timeout_ms:
        with conn.cursor() as cur:
            cur.execute(f"SET statement_timeout TO {timeout_ms}")
    return conn


def _fetch_all(query: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Execute a query and return all rows as dictionaries.
    """
    conn = get_mb_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(query, params)
                return list(cur.fetchall())
    finally:
        conn.close()


def search_artists_by_name_db(
    query: str,
    limit: int = 5,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """
    Search artists in the MusicBrainz DB by name or alias.
    """
    rows = _fetch_all(
        """
        SELECT DISTINCT ON (a.id)
            a.id,
            a.gid,
            a.name,
            a.sort_name,
            a.type,
            a.area,
            a.begin_date_year,
            a.end_date_year
        FROM artist a
        LEFT JOIN artist_alias aa ON aa.artist = a.id
        WHERE a.name ILIKE %(q)s
           OR aa.name ILIKE %(q)s
        ORDER BY a.id
        LIMIT %(limit)s
        OFFSET %(offset)s;
        """,
        {"q": f"%{query}%", "limit": limit, "offset": offset},
    )

    results: List[Dict[str, Any]] = []
    for row in rows:
        gid = row.get("gid")
        gid_str = str(gid) if gid else None
        internal_id = row.get("id")
        results.append(
            {
                "id": gid_str,
                "gid": gid_str,
                "mb_internal_id": internal_id,
                "name": row.get("name"),
                "sort-name": row.get("sort_name"),
                "type": row.get("type"),
                "area": row.get("area"),
                "begin-date-year": row.get("begin_date_year"),
                "end-date-year": row.get("end_date_year"),
                "country": None,
                "score": 100,
            }
        )

    return results


def get_artist_by_mbid_db(mbid: str) -> Optional[Dict[str, Any]]:
    """
    Fetch a single artist by MBID from the DB.
    """
    rows = _fetch_all(
        """
        SELECT
            a.id,
            a.gid,
            a.name,
            a.sort_name,
            a.type,
            a.area,
            a.begin_date_year,
            a.end_date_year
        FROM artist a
        WHERE a.gid = %(mbid)s
        LIMIT 1;
        """,
        {"mbid": mbid},
    )
    if not rows:
        return None

    row = rows[0]
    gid = row.get("gid")
    gid_str = str(gid) if gid else None
    internal_id = row.get("id")
    return {
        "id": gid_str,
        "gid": gid_str,
        "mb_internal_id": internal_id,
        "name": row.get("name"),
        "sort-name": row.get("sort_name"),
        "type": row.get("type"),
        "area": row.get("area"),
        "begin-date-year": row.get("begin_date_year"),
        "end-date-year": row.get("end_date_year"),
        "country": None,
    }


def get_artist_tags_db(mbid: str) -> List[Dict[str, Any]]:
    """
    Return tags for an artist MBID.
    """
    rows = _fetch_all(
        """
        SELECT
            t.name,
            at.count
        FROM artist_tag at
        JOIN tag t   ON t.id = at.tag
        JOIN artist a ON a.id = at.artist
        WHERE a.gid = %(mbid)s
        ORDER BY at.count DESC
        LIMIT 50;
        """,
        {"mbid": mbid},
    )

    tags: List[Dict[str, Any]] = []
    for row in rows:
        tags.append(
            {
                "name": row.get("name"),
                "count": row.get("count"),
            }
        )
    return tags


def get_artist_release_groups_db(
    mbid: str,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Return release groups for an artist MBID.
    """
    rows = _fetch_all(
        """
        SELECT
            rg.gid  AS release_group_mbid,
            rg.name AS release_group_name,
            MIN(ar.first_release_date) AS first_release_date
        FROM artist a
        JOIN artist_credit_name acn ON acn.artist = a.id
        JOIN artist_credit ac       ON ac.id = acn.artist_credit
        JOIN release_group rg       ON rg.artist_credit = ac.id
        JOIN release r              ON r.release_group = rg.id
        LEFT JOIN artist_release ar ON ar.release = r.id
                                     AND ar.artist  = a.id
        WHERE a.gid = %(mbid)s
        GROUP BY rg.id, rg.gid, rg.name
        ORDER BY first_release_date NULLS LAST, release_group_name
        LIMIT %(limit)s;
        """,
        {"mbid": mbid, "limit": limit},
    )

    release_groups: List[Dict[str, Any]] = []
    for row in rows:
        gid = row.get("release_group_mbid")
        gid_str = str(gid) if gid else None
        release_groups.append(
            {
                "id": gid_str,
                "mbid": gid_str,
                "title": row.get("release_group_name"),
                "first-release-date": row.get("first_release_date"),
            }
        )
    return release_groups


# ---------------------------------------------------------------------------
# Taste profile helpers
# ---------------------------------------------------------------------------


def upsert_artist_spotify_genres(artist_id: int, spotify_genres: Sequence[str]) -> None:
    """
    Insert or update Spotify genres for a MusicBrainz artist_id.
    """
    genres_clean = []
    for g in spotify_genres:
        if not g:
            continue
        cleaned = str(g).strip().lower()
        if cleaned:
            genres_clean.append(cleaned)

    with get_mb_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.artist_spotify_genres_v1 (artist_id, spotify_genres)
                VALUES (%s, %s)
                ON CONFLICT (artist_id)
                DO UPDATE SET
                    spotify_genres = EXCLUDED.spotify_genres,
                    updated_at = NOW();
                """,
                (artist_id, genres_clean),
            )


def fetch_user_top_clusters(user_id: str, top_n: int = 3) -> List[Dict[str, Any]]:
    """
    Return top-N clusters for a user from user_taste_clusters_v1.
    """
    if not user_id:
        return []

    with get_mb_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT user_id, cluster_id, weight
                FROM public.user_taste_clusters_v1
                WHERE user_id = %s
                ORDER BY weight DESC
                LIMIT %s;
                """,
                (user_id, top_n),
            )
            return list(cur.fetchall() or [])


def fetch_artist_primary_clusters(artist_ids: Sequence[int]) -> Dict[int, Dict[str, Any]]:
    """
    For each artist_id, return the highest-weight cluster from artist_cluster_profile_v1.
    """
    if not artist_ids:
        return {}

    with get_mb_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                WITH ranked AS (
                    SELECT
                        artist_id,
                        cluster_id,
                        cluster_weight,
                        ROW_NUMBER() OVER (PARTITION BY artist_id ORDER BY cluster_weight DESC) AS rn
                    FROM public.artist_cluster_profile_v1
                    WHERE artist_id = ANY(%s)
                )
                SELECT artist_id, cluster_id, cluster_weight
                FROM ranked
                WHERE rn = 1;
                """,
                (list(artist_ids),),
            )
            rows = cur.fetchall() or []
            return {int(r["artist_id"]): r for r in rows}


def fetch_cluster_labels(cluster_ids: Sequence[int]) -> Dict[int, Dict[str, Any]]:
    """
    Return cluster labels from cluster_labels_spotify_v1 for the given clusters.
    """
    if not cluster_ids:
        return {}

    with get_mb_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT cluster_id, label_primary, label_secondary, top_spotify_genres
                FROM public.cluster_labels_spotify_v1
                WHERE cluster_id = ANY(%s);
                """,
                (list(cluster_ids),),
            )
            rows = cur.fetchall() or []
            return {int(r["cluster_id"]): r for r in rows}
