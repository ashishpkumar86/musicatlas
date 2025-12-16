"""Artist enrichment service that bridges MusicBrainz and TIDAL data."""

from typing import Any, Dict, List, Optional

from app.clients.musicbrainz_client import get_artist, search_artists
from app.clients.tidal_client import get_artist_summary, search_artist_raw
from app.services.sonic_tags import normalize_artist_name
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Simple in-memory cache for artist enrichment
# Key: (normalized_name, normalized_country_code)
# Value: enriched artist dict (same shape as the function output)
_artist_enrichment_cache: Dict[tuple, Any] = {}


def _choose_best_mb_candidate(
    artists: List[Dict[str, Any]],
    country_code: Optional[str],
) -> Optional[Dict[str, Any]]:
    """
    Pick the "best" MusicBrainz artist from a search result.

    Strategy:
      1. If country_code is provided, prefer artists matching that country.
      2. Within that subset (or the full list if no matches), pick the one
         with the highest MusicBrainz `score` field.
    """
    if not artists:
        return None

    if country_code:
        candidates = [a for a in artists if a.get("country") == country_code]
        if not candidates:
            candidates = artists
    else:
        candidates = artists

    def score(a: Dict[str, Any]) -> int:
        try:
            return int(a.get("score", 0))
        except (TypeError, ValueError):
            return 0

    return max(candidates, key=score)


def _extract_tags_from_mb(artist: Dict[str, Any], limit: int = 5) -> List[str]:
    """
    Extract up to `limit` tags from MusicBrainz artist data,
    sorted by descending `count`.
    """
    tags_block = artist.get("tags") or []
    if not isinstance(tags_block, list):
        return []

    def tag_score(tag: Dict[str, Any]) -> int:
        try:
            return int(tag.get("count", 0))
        except (TypeError, ValueError):
            return 0

    sorted_tags = sorted(tags_block, key=tag_score, reverse=True)
    names = [t.get("name") for t in sorted_tags if isinstance(t, dict) and t.get("name")]
    seen = set()
    result: List[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            result.append(n)
        if len(result) >= limit:
            break
    return result


def _extract_members_from_mb(artist: Dict[str, Any]) -> List[str]:
    """
    Try to extract band members from MusicBrainz relations.

    This is a heuristic and may not always be perfect. It looks at relations
    that contain an 'artist' object and are of type 'member of band' or 'member'.
    """
    relations = artist.get("relations") or []
    if not isinstance(relations, list):
        return []

    members: List[str] = []

    for rel in relations:
        if not isinstance(rel, dict):
            continue

        rel_type = (rel.get("type") or "").lower()
        if rel_type not in ("member of band", "member"):
            continue

        artist_obj = rel.get("artist")
        if isinstance(artist_obj, dict):
            name = artist_obj.get("name")
            if name:
                members.append(name)

    seen = set()
    unique_members: List[str] = []
    for m in members:
        if m not in seen:
            seen.add(m)
            unique_members.append(m)

    return unique_members


def _extract_latest_album_from_mb(artist: Dict[str, Any]) -> Optional[str]:
    """
    Try to pick a 'latest album' from the included release-groups, if present.
    """
    rgs = artist.get("release-groups") or []
    if not isinstance(rgs, list) or not rgs:
        return None

    def sort_key(rg: Dict[str, Any]) -> str:
        date_str = str(rg.get("first-release-date") or "")
        return date_str

    album_rgs = [
        rg
        for rg in rgs
        if isinstance(rg, dict) and (rg.get("primary-type") or "").lower() == "album"
    ]
    candidates = album_rgs or [rg for rg in rgs if isinstance(rg, dict)]

    best = max(candidates, key=sort_key)
    return best.get("title")


def _extract_label_from_mb(artist: Dict[str, Any]) -> Optional[str]:
    """
    Very light heuristic to extract a label connection from MusicBrainz.
    """
    relations = artist.get("relations") or []
    if not isinstance(relations, list):
        return None

    for rel in relations:
        if not isinstance(rel, dict):
            continue
        rel_type = (rel.get("type") or "").lower()
        if "label" not in rel_type:
            continue

        label_obj = rel.get("label")
        if isinstance(label_obj, dict):
            name = label_obj.get("name")
            if name:
                return name

    return None


def _find_best_tidal_artist_id(
    name: str,
    country_code: str = "DE",
) -> Optional[str]:
    """
    Given a canonical artist name, search TIDAL and return the best artist ID.
    """
    try:
        raw = search_artist_raw(name, country_code=country_code, limit=10, offset=0)
    except Exception as exc:
        logger.info("[enrichment] TIDAL search failed for %r: %s", name, exc)
        return None

    included = (raw or {}).get("included") or []
    if not isinstance(included, list) or not included:
        return None

    target = name.strip().lower()
    first_id: Optional[str] = None
    exact_id: Optional[str] = None

    for item in included:
        if item.get("type") != "artists":
            continue

        artist_id = item.get("id")
        attrs = item.get("attributes") or {}
        tidal_name = (attrs.get("name") or "").strip()

        if artist_id and first_id is None:
            first_id = artist_id

        if tidal_name and artist_id and tidal_name.lower() == target:
            exact_id = artist_id
            break

    return exact_id or first_id


def enrich_artist_by_name(
    name: str,
    country_code: str = "DE",
) -> Optional[Dict[str, Any]]:
    """
    High-level enrichment for an artist name.

    Data sources:
      - MusicBrainz:
          * canonical artist name
          * country
          * tags (genres, styles)
          * members (best-effort)
          * latest album (best-effort from release-groups)
          * label (very best-effort from relations)
      - TIDAL:
          * imageUrl
          * popularity
          * tidalUrl

    Returns:
      A dict shaped for the frontend "artist card", or None if nothing
      could be found at all.
    """
    normalized_name = normalize_artist_name(name) or name.strip()
    normalized_country = (country_code or "").strip().upper()
    cache_key = (normalized_name.lower(), normalized_country)

    cached = _artist_enrichment_cache.get(cache_key)
    if cached is not None:
        return cached

    mb_artist: Optional[Dict[str, Any]] = None

    try:
        search_result = search_artists(normalized_name, limit=5, offset=0)
        artists = search_result.get("artists") or []
        if isinstance(artists, list) and artists:
            candidate = _choose_best_mb_candidate(artists, country_code)
            if candidate and candidate.get("id"):
                mb_artist = get_artist(
                    candidate["id"],
                    include_tags=True,
                    include_aliases=False,
                    include_rels=True,
                )
    except Exception as exc:
        logger.info("[enrichment] MusicBrainz lookup failed for %r: %s", name, exc)
        mb_artist = None

    if mb_artist is None:
        return None

    out_name = mb_artist.get("name") or normalized_name
    out_country = mb_artist.get("country") or normalized_country

    members = _extract_members_from_mb(mb_artist)
    tags = _extract_tags_from_mb(mb_artist)
    latest_album = _extract_latest_album_from_mb(mb_artist)
    label = _extract_label_from_mb(mb_artist)

    genre = tags[0] if tags else None

    tidal_id: Optional[str] = None
    tidal_summary: Optional[Dict[str, Any]] = None

    try:
        tidal_id = _find_best_tidal_artist_id(out_name, country_code)
        logger.info("[enrichment] Chosen TIDAL artist for %r: %s", out_name, tidal_id)
        if tidal_id:
            tidal_summary = get_artist_summary(str(tidal_id), country_code)
            logger.info(
                "[enrichment] TIDAL summary imageUrl=%r",
                (tidal_summary or {}).get("imageUrl"),
            )
    except Exception as exc:
        logger.info("[enrichment] TIDAL enrichment failed for name=%r: %s", out_name, exc)
        tidal_summary = None

    result = {
        "name": out_name,
        "country": out_country,
        "members": members,
        "tags": tags,
        "genre": genre,
        "latestAlbum": latest_album,
        "label": label,
        "tidalId": tidal_id,
        "tidalUrl": (tidal_summary or {}).get("tidalUrl"),
        "imageUrl": (tidal_summary or {}).get("imageUrl"),
        "popularity": (tidal_summary or {}).get("popularity"),
    }

    _artist_enrichment_cache[cache_key] = result

    return result
