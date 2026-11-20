"""One error shape for the whole API (spec 8.5). Never leaks paths, secrets or stack traces."""
from __future__ import annotations

import logging
import re

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("sudokumind.api")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, *, recoverable: bool = True, retryable: bool = False,
                 details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.recoverable, self.retryable, self.details = recoverable, retryable, details or {}

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "recoverable": self.recoverable,
                          "retryable": self.retryable, "details": self.details}}


def check_id(value: str, what: str = "id") -> str:
    if not ID_RE.match(value or ""):
        raise APIError(422, "INVALID_ID", f"{what} has an invalid format", recoverable=True)
    return value


def not_found(what: str, ident: str) -> APIError:
    return APIError(404, f"{what.upper()}_NOT_FOUND", f"{what} '{ident[:64]}' was not found", recoverable=True)


def _sanitize(errors: list[dict]) -> list[dict]:
    out = []
    for e in errors[:20]:
        out.append({"loc": [str(x) for x in e.get("loc", [])][:6], "message": str(e.get("msg", ""))[:200], "type": e.get("type")})
    return out


def install(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api(_: Request, exc: APIError):
        return JSONResponse(exc.body(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errs = exc.errors()
        board_related = any("board" in [str(x) for x in e.get("loc", [])] for e in errs)
        code = "INVALID_BOARD" if board_related else "INVALID_REQUEST"
        msg = "The board must be a 4x4 list of integers 0..4 (0 = empty)." if board_related else "The request is invalid."
        return JSONResponse(APIError(422, code, msg, details={"errors": _sanitize(errs)}).body(), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(APIError(exc.status_code, code, "The requested resource or method is not available.").body(),
                            status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error on %s %s", request.method, request.url.path)   # detail stays in local logs
        return JSONResponse(APIError(500, "INTERNAL_ERROR", "An internal error occurred.", recoverable=False,
                                     retryable=True).body(), status_code=500)
