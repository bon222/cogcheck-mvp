from pathlib import Path

import csv
import io
import os
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import Base, engine, get_db


app = FastAPI(title="CogCheck API", version="0.1.0")
ROOT_DIR = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT_DIR / "mvp_web"
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
ADMIN_TABLES = {"users", "sessions", "attempts", "raw_events", "labels"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if WEB_DIR.exists():
    app.mount("/mvp", StaticFiles(directory=WEB_DIR), name="mvp")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def web_home() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


def require_admin_token(token: str | None) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin token not configured.")
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token.")


@app.post("/admin/clear")
def admin_clear(token: str | None = None, db: Session = Depends(get_db)) -> dict[str, str]:
    require_admin_token(token)
    db.execute(models.RawEvent.__table__.delete())
    db.execute(models.Label.__table__.delete())
    db.execute(models.Attempt.__table__.delete())
    db.execute(models.GameSession.__table__.delete())
    db.execute(models.User.__table__.delete())
    db.commit()
    return {"status": "cleared"}


@app.get("/admin/export/{table_name}")
def admin_export(table_name: str, token: str | None = None, db: Session = Depends(get_db)) -> StreamingResponse:
    require_admin_token(token)
    if table_name not in ADMIN_TABLES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown table.")

    table_map = {
        "users": models.User.__table__,
        "sessions": models.GameSession.__table__,
        "attempts": models.Attempt.__table__,
        "raw_events": models.RawEvent.__table__,
        "labels": models.Label.__table__,
    }
    result = db.execute(table_map[table_name].select())
    rows = result.fetchall()
    headers = result.keys()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(headers)
    writer.writerows(rows)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={table_name}.csv"},
    )


@app.post("/users/register", response_model=schemas.UserOut)
def register_user(payload: schemas.UserCreate, db: Session = Depends(get_db)) -> schemas.UserOut:
    return crud.create_or_update_user(db, payload)


@app.get("/users/by-device/{device_user_id}", response_model=schemas.UserOut)
def get_user_by_device(device_user_id: str, db: Session = Depends(get_db)) -> schemas.UserOut:
    user = crud.get_user_by_device_user_id(db, device_user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


@app.post("/sessions", response_model=schemas.SessionOut)
def create_session(payload: schemas.SessionCreate, db: Session = Depends(get_db)) -> schemas.SessionOut:
    user = crud.get_user(db, payload.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return crud.create_session(db, payload)


@app.get("/baseline/{user_id}/{game_type}", response_model=schemas.BaselineStatusOut)
def get_baseline_status(user_id: str, game_type: schemas.GameType, db: Session = Depends(get_db)) -> schemas.BaselineStatusOut:
    user = crud.get_user(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    completed = crud.count_baseline_attempts(db, user_id, game_type)
    return schemas.BaselineStatusOut(
        user_id=user_id,
        game_type=game_type,
        baseline_attempts_completed=completed,
        baseline_complete=completed >= crud.BASELINE_REQUIRED_ATTEMPTS,
    )


@app.post("/attempts", response_model=schemas.AttemptOut)
def submit_attempt(payload: schemas.AttemptCreate, db: Session = Depends(get_db)) -> schemas.AttemptOut:
    user = crud.get_user(db, payload.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if payload.session_id is not None:
        session = db.get(models.GameSession, payload.session_id)
        if session is None or session.user_id != payload.user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Session does not exist for this user.",
            )

    try:
        return crud.create_attempt(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.post("/labels", response_model=schemas.LabelOut)
def submit_label(payload: schemas.LabelCreate, db: Session = Depends(get_db)) -> schemas.LabelOut:
    user = crud.get_user(db, payload.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return crud.create_label(db, payload)
