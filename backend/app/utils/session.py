"""Session utilities for interacting with the in-memory session store."""

from typing import Dict, List

from app.utils.config import SESSIONS


def _ensure_session_defaults(session: Dict) -> Dict:
    """
    Add default fields to a session dict in-place.
    Currently ensures we always have an mb_artist_mbids list.
    """
    if "mb_artist_mbids" not in session:
        session["mb_artist_mbids"] = []
    return session


def get_session_mb_artist_mbids(session_id: str) -> List[str]:
    """
    Return the canonical MB artist MBID list for this session, or [] if none.
    """
    session = SESSIONS.get(session_id)
    if not session:
        return []

    _ensure_session_defaults(session)
    mbids = session.get("mb_artist_mbids") or []
    if isinstance(mbids, list):
        return mbids
    return []


def set_session_mb_artist_mbids(session_id: str, mbids: List[str]) -> None:
    """
    Store the canonical MB artist MBID list for this session.
    """
    session = SESSIONS.get(session_id)
    if session is None:
        return

    _ensure_session_defaults(session)
    session["mb_artist_mbids"] = mbids
    SESSIONS[session_id] = session


def ensure_session_defaults(session_id: str) -> Dict:
    """
    Ensure default fields exist on a stored session and return the session.
    Useful when we just fetched a session from the cookie store.
    """
    session = SESSIONS.get(session_id, {})
    session = _ensure_session_defaults(session)
    SESSIONS[session_id] = session
    return session
