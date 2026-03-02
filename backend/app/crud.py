from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models, schemas

BASELINE_REQUIRED_ATTEMPTS = 3


def get_user_by_device_user_id(db: Session, device_user_id: str) -> models.User | None:
    return db.scalar(select(models.User).where(models.User.device_user_id == device_user_id))


def get_user(db: Session, user_id: str) -> models.User | None:
    return db.scalar(select(models.User).where(models.User.id == user_id))


def create_or_update_user(db: Session, payload: schemas.UserCreate) -> models.User:
    user = get_user_by_device_user_id(db, payload.device_user_id)
    if user is None:
        user = models.User(
            device_user_id=payload.device_user_id,
            first_name=payload.first_name.strip(),
            last_name=payload.last_name.strip(),
        )
        db.add(user)
    else:
        user.first_name = payload.first_name.strip()
        user.last_name = payload.last_name.strip()

    db.commit()
    db.refresh(user)
    return user


def create_session(db: Session, payload: schemas.SessionCreate) -> models.GameSession:
    session = models.GameSession(user_id=payload.user_id, baseline_mode=payload.baseline_mode)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def count_baseline_attempts(db: Session, user_id: str, game_type: str) -> int:
    stmt = (
        select(func.count(models.Attempt.id))
        .where(models.Attempt.user_id == user_id)
        .where(models.Attempt.game_type == game_type)
        .where(models.Attempt.baseline_flag.is_(True))
    )
    return int(db.scalar(stmt) or 0)


def count_normal_attempts(db: Session, user_id: str, game_type: str) -> int:
    stmt = (
        select(func.count(models.Attempt.id))
        .where(models.Attempt.user_id == user_id)
        .where(models.Attempt.game_type == game_type)
        .where(models.Attempt.baseline_flag.is_(False))
    )
    return int(db.scalar(stmt) or 0)


def create_attempt(db: Session, payload: schemas.AttemptCreate) -> models.Attempt:
    baseline_completed = count_baseline_attempts(db, payload.user_id, payload.game_type)

    if not payload.baseline_flag and baseline_completed < BASELINE_REQUIRED_ATTEMPTS:
        raise ValueError(
            f"Baseline incomplete for {payload.game_type}: "
            f"{baseline_completed}/{BASELINE_REQUIRED_ATTEMPTS} attempts completed."
        )

    attempt_number = (
        baseline_completed + 1
        if payload.baseline_flag
        else count_normal_attempts(db, payload.user_id, payload.game_type) + 1
    )

    attempt = models.Attempt(
        user_id=payload.user_id,
        session_id=payload.session_id,
        game_type=payload.game_type,
        baseline_flag=payload.baseline_flag,
        attempt_number=attempt_number,
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        duration_ms=payload.duration_ms,
        success=payload.success,
        summary=payload.summary,
    )
    db.add(attempt)
    db.flush()

    for event in payload.raw_events:
        db.add(
            models.RawEvent(
                attempt_id=attempt.id,
                event_index=event.event_index,
                t_ms=event.t_ms,
                event_type=event.event_type,
                x=event.x,
                y=event.y,
                force=event.force,
                radius=event.radius,
                payload=event.payload,
            )
        )

    db.commit()
    db.refresh(attempt)
    return attempt


def create_label(db: Session, payload: schemas.LabelCreate) -> models.Label:
    label = models.Label(
        user_id=payload.user_id,
        session_id=payload.session_id,
        attempt_id=payload.attempt_id,
        alcohol_status=payload.alcohol_status,
        sleep_hours=payload.sleep_hours,
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return label
