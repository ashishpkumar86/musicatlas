"""Pydantic models for artist-related request bodies."""

from typing import Optional
from pydantic import BaseModel


class UserArtistInput(BaseModel):
    """Artist input supplied by the frontend when building sonic tags."""

    name: str
    source: str
    source_id: Optional[str] = None
    country_code: Optional[str] = None

