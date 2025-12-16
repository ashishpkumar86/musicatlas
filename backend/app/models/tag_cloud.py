"""Pydantic helpers for tag cloud responses."""

from typing import Optional
from pydantic import BaseModel


class SonicTag(BaseModel):
    """Represents a single tag with its weight."""

    name: str
    score: float
    raw_count: Optional[int] = None

