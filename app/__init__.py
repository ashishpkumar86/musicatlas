"""Music Atlas FastAPI application package."""

from pathlib import Path

from dotenv import load_dotenv

# Ensure .env is loaded before any module-level env reads in the app.
# Explicit path avoids relying on the server's working directory.
_BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BASE_DIR / ".env")
