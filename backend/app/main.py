from pathlib import Path

import csv
import io
import os
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import Base, engine, get_db


app = FastAPI(title="CogCheck API", version="0.1.0")
ROOT_DIR = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT_DIR / "mvp_web"
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
ADMIN_TABLES = {"users", "attempts", "raw_events"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def web_home() -> FileResponse:
    response = FileResponse(WEB_DIR / "index.html")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/app.js")
def web_app_js() -> FileResponse:
    response = FileResponse(WEB_DIR / "app.js")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/styles.css")
def web_styles() -> FileResponse:
    response = FileResponse(WEB_DIR / "styles.css")
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


def require_admin_token(token: str | None) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin token not configured.")
    if token != ADMIN_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin token.")


@app.post("/admin/clear")
def admin_clear(token: str | None = None, db: Session = Depends(get_db)) -> dict[str, str]:
    require_admin_token(token)
    db.execute(models.RawEvent.__table__.delete())
    db.execute(models.Attempt.__table__.delete())
    db.execute(models.User.__table__.delete())
    db.commit()
    return {"status": "cleared"}


@app.post("/admin/reset")
def admin_reset(token: str | None = None) -> dict[str, str]:
    require_admin_token(token)
    try:
        if engine.dialect.name == "postgresql":
            with engine.begin() as conn:
                conn.exec_driver_sql("DROP SCHEMA public CASCADE;")
                conn.exec_driver_sql("CREATE SCHEMA public;")
            Base.metadata.create_all(bind=engine)
        else:
            Base.metadata.drop_all(bind=engine)
            Base.metadata.create_all(bind=engine)
        return {"status": "reset"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Reset failed: {exc}") from exc


@app.get("/admin/export/{table_name}")
def admin_export(table_name: str, token: str | None = None, db: Session = Depends(get_db)) -> StreamingResponse:
    require_admin_token(token)
    if table_name not in ADMIN_TABLES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown table.")

    table_map = {
        "users": models.User.__table__,
        "attempts": models.Attempt.__table__,
        "raw_events": models.RawEvent.__table__,
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


@app.get("/baseline/{user_id}", response_model=schemas.BaselineStatusOut)
def get_baseline_status(user_id: str, db: Session = Depends(get_db)) -> schemas.BaselineStatusOut:
    user = crud.get_user(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    completed = crud.count_baseline_attempts(db, user_id)
    return schemas.BaselineStatusOut(
        user_id=user_id,
        baseline_attempts_completed=completed,
        baseline_complete=completed >= crud.BASELINE_REQUIRED_ATTEMPTS,
    )


@app.post("/attempts", response_model=schemas.AttemptOut)
def submit_attempt(payload: schemas.AttemptCreate, db: Session = Depends(get_db)) -> schemas.AttemptOut:
    user = crud.get_user(db, payload.user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    try:
        return crud.create_attempt(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
