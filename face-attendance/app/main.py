"""Application factory and static-file mounting."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import ADMIN_PASSWORD, STATIC_DIR
from app.database import initialize_database, read_setting
from app.routers import attendance, auth, people
from app.security import tokens


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database()
    if read_setting("admin_password_hash") is None and len(ADMIN_PASSWORD) < 12:
        raise RuntimeError("Set ADMIN_PASSWORD to a unique value with at least 12 characters before starting.")
    yield
    tokens.clear()


app = FastAPI(title="MHHS Attendance System", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(people.router)
app.include_router(attendance.router)
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
