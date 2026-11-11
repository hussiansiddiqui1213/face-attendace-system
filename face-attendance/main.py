"""Compatibility entry point for running ``uvicorn main:app``."""

from app.main import app

__all__ = ["app"]
