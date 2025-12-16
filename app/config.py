"""Centralized settings for the backend."""

import os


class Settings:
    """
    Lightweight settings loader.

    Avoids extra dependencies while keeping a single import point for env vars.
    """

    def __init__(self) -> None:
        self.MB_SOURCE = os.environ.get("MB_SOURCE", "api").lower()
        self.MB_DATABASE_URL = os.environ.get("MB_DATABASE_URL")


settings = Settings()

__all__ = ["settings"]
