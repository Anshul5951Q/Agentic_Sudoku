"""Run the API:  python -m backend   (host/port come from SUDOKU_API_HOST / SUDOKU_API_PORT)."""
import uvicorn

from .app.core.config import Settings
from .app.main import create_app

if __name__ == "__main__":
    s = Settings.from_env()
    uvicorn.run(create_app(s), host=s.host, port=s.port)
