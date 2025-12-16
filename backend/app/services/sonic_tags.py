"""Services for building sonic tag clouds and canonical artist lists."""

from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.clients.musicbrainz_client import get_artist, search_artists
from app.models.artist_inputs import UserArtistInput
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Very simple in-memory cache for MB artist lookups keyed by normalized name + country
_MB_ARTIST_CACHE: Dict[Tuple[str, str], Optional[Dict[str, Any]]] = {}

# Blacklisted MusicBrainz tags that are clearly non-sonic metadata
_MB_TAG_BLACKLIST = {
    "seen live",
    "favourite",
    "favorite",
    "favorites",
    "favourites",
    "my favorite",
    "my favourite",
    "underrated",
    "underated",
    "underappreciated",
}


def normalize_artist_name(name: str) -> str:
    """
    Normalize artist names for caching and comparison:
    - strip leading/trailing whitespace
    - collapse internal whitespace
    - lowercase
    """
    if not name:
        return ""
    return " ".join(name.strip().lower().split())


def choose_best_mb_candidate(
    candidates: List[Dict[str, Any]],
    target_name: str,
    country_code: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Pick the "best" MusicBrainz artist candidate for a given name.

    Strategy:
      1. Normalize target + candidate names and prefer exact matches.
      2. If country_code is provided, prefer candidates matching that country.
      3. Within the final subset, pick the one with the highest MusicBrainz `score`.
    """
    if not candidates:
        return None

    norm_target = normalize_artist_name(target_name)

    exact_matches = []
    for c in candidates:
        c_name = normalize_artist_name(str(c.get("name") or ""))
        if c_name == norm_target:
            exact_matches.append(c)

    if exact_matches:
        candidates_to_use = exact_matches
    else:
        candidates_to_use = candidates

    if country_code:
        by_country = [
            c for c in candidates_to_use if c.get("country") == country_code
        ]
        if by_country:
            candidates_to_use = by_country

    def score(c: Dict[str, Any]) -> int:
        try:
            return int(c.get("score", 0))
        except (TypeError, ValueError):
            return 0

    return max(candidates_to_use, key=score)


def fetch_musicbrainz_artist_full(
    name: str,
    country_code: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Search MusicBrainz for an artist by name and, if found, fetch full artist data.

    Uses:
      - musicbrainz_client.search_artists (search)
      - musicbrainz_client.get_artist (details, including tags)

    Returns:
      Full MB artist JSON dict on success, or None if we can't find a good match.
    """
    cache_key = (normalize_artist_name(name), (country_code or "").upper())
    if cache_key in _MB_ARTIST_CACHE:
        return _MB_ARTIST_CACHE[cache_key]

    search_result = search_artists(query=name, limit=5, offset=0)
    candidates = search_result.get("artists") or []

    best = choose_best_mb_candidate(candidates, target_name=name, country_code=country_code)
    if not best:
        _MB_ARTIST_CACHE[cache_key] = None
        return None

    mbid = best.get("id")
    if not mbid:
        _MB_ARTIST_CACHE[cache_key] = None
        return None

    try:
        artist_full = get_artist(
            mbid=mbid,
            include_tags=True,
            include_aliases=True,
            include_rels=False,
        )
    except requests.HTTPError as e:
        logger.info("MusicBrainz get_artist error for %s (%s): %s", name, mbid, e)
        _MB_ARTIST_CACHE[cache_key] = None
        return None

    _MB_ARTIST_CACHE[cache_key] = artist_full
    return artist_full


def extract_tags_from_mb_artist(artist: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract and clean tags from a MusicBrainz artist dict.

    Returns:
      List of { "name": str, "count": int } after:
        - lowercasing names
        - stripping whitespace
        - dropping obviously non-sonic tags (blacklist)
    """
    raw_tags = artist.get("tags") or []
    cleaned: List[Dict[str, Any]] = []

    for t in raw_tags:
        name = str(t.get("name") or "").strip().lower()
        if not name or name in _MB_TAG_BLACKLIST:
            continue

        try:
            count = int(t.get("count", 0))
        except (TypeError, ValueError):
            count = 0

        cleaned.append({"name": name, "count": count})

    return cleaned


def build_tag_cloud_from_canonical_artists(
    canonical_artists: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Aggregate tags across all canonical artists into a tag cloud.

    For v0:
      - Each artist has equal weight.
      - Within an artist, we use MusicBrainz 'count' as tag strength.
      - We sum counts across artists → raw_count.
      - We normalize by max(raw_count) to get a [0,1] 'score'.
    """
    counter = Counter()

    for artist in canonical_artists:
        for tag in artist.get("tags") or []:
            name = tag.get("name")
            if not name:
                continue
            count = tag.get("count") or 0
            try:
                count = int(count)
            except (TypeError, ValueError):
                count = 0
            if count <= 0:
                continue
            counter[name] += count

    if not counter:
        return []

    max_count = max(counter.values())

    tag_cloud: List[Dict[str, Any]] = []
    for name, raw_count in counter.most_common():
        score = raw_count / max_count if max_count > 0 else 0.0
        tag_cloud.append(
            {
                "name": name,
                "raw_count": raw_count,
                "score": round(score, 4),
            }
        )

    return tag_cloud


def build_user_sonic_tags(artists: List[UserArtistInput]) -> Dict[str, Any]:
    """
    Build a user-level tag cloud + canonical artist list from a list of input artists.
    """
    if not artists:
        raise ValueError("No artists provided")

    grouped: Dict[str, Dict[str, Any]] = {}
    for item in artists:
        norm_name = normalize_artist_name(item.name)
        if not norm_name:
            continue

        entry = grouped.get(norm_name)
        if not entry:
            entry = {
                "display_name": item.name.strip(),
                "country_code": item.country_code,
                "source_ids": {},
            }
            grouped[norm_name] = entry

        if not entry.get("country_code") and item.country_code:
            entry["country_code"] = item.country_code

        if item.source:
            src = item.source
            src_map = entry["source_ids"].setdefault(src, set())
            if item.source_id:
                src_map.add(item.source_id)

    canonical_artists: List[Dict[str, Any]] = []
    not_found: List[Dict[str, Any]] = []

    for norm_name, data in grouped.items():
        display_name = data["display_name"]
        country_code = data.get("country_code")
        source_ids_map = data["source_ids"]

        mb_artist = fetch_musicbrainz_artist_full(display_name, country_code=country_code)
        if not mb_artist:
            not_found.append(
                {
                    "name": display_name,
                    "sources": list(source_ids_map.keys()),
                }
            )
            continue

        mbid = mb_artist.get("id")
        country = mb_artist.get("country")
        tags = extract_tags_from_mb_artist(mb_artist)

        source_ids_serializable: Dict[str, List[str]] = {}
        for src, ids_set in source_ids_map.items():
            source_ids_serializable[src] = sorted(list(ids_set))

        canonical_artists.append(
            {
                "canonicalArtistId": mbid,
                "name": mb_artist.get("name", display_name),
                "mbid": mbid,
                "country": country,
                "sourceIds": source_ids_serializable,
                "tags": tags,
            }
        )

    tag_cloud = build_tag_cloud_from_canonical_artists(canonical_artists)

    return {
        "canonical_artists": canonical_artists,
        "tag_cloud": tag_cloud,
        "not_found": not_found,
    }


def build_user_sonic_tags_from_mbids(mbids: List[str]) -> Dict[str, Any]:
    """
    Build a user-level tag cloud + canonical artist list directly from MusicBrainz IDs.
    """
    if not mbids:
        raise ValueError("No MBIDs provided")

    unique_mbids = [mbid for mbid in dict.fromkeys(mbids) if mbid]
    canonical_artists: List[Dict[str, Any]] = []
    not_found: List[Dict[str, Any]] = []

    for mbid in unique_mbids:
        try:
            mb_artist = get_artist(
                mbid=mbid,
                include_tags=True,
                include_aliases=True,
                include_rels=False,
            )
        except requests.HTTPError as e:
            logger.info("MusicBrainz get_artist error for %s: %s", mbid, e)
            mb_artist = None
        except Exception as exc:
            logger.info("Unexpected MusicBrainz error for %s: %s", mbid, exc)
            mb_artist = None

        if not mb_artist:
            not_found.append({"mbid": mbid})
            continue

        tags = extract_tags_from_mb_artist(mb_artist)
        canonical_artists.append(
            {
                "canonicalArtistId": mbid,
                "name": mb_artist.get("name", ""),
                "mbid": mbid,
                "country": mb_artist.get("country"),
                "sourceIds": {},
                "tags": tags,
            }
        )

    tag_cloud = build_tag_cloud_from_canonical_artists(canonical_artists)
    return {
        "canonical_artists": canonical_artists,
        "tag_cloud": tag_cloud,
        "not_found": not_found,
    }
