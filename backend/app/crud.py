from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models, schemas

BASELINE_REQUIRED_ATTEMPTS = 3


def get_user(db: Session, user_id: str) -> models.User | None:
    return db.scalar(select(models.User).where(models.User.id == user_id))


def get_user_by_name(db: Session, first_name: str, last_name: str) -> models.User | None:
    return db.scalar(
        select(models.User)
        .where(models.User.first_name == first_name.strip())
        .where(models.User.last_name == last_name.strip())
    )


def create_or_update_user(db: Session, payload: schemas.UserCreate) -> models.User:
    user = get_user_by_name(db, payload.first_name, payload.last_name)
    if user is None:
        user = models.User(first_name=payload.first_name.strip(), last_name=payload.last_name.strip())
        db.add(user)
    else:
        user.first_name = payload.first_name.strip()
        user.last_name = payload.last_name.strip()

    db.commit()
    db.refresh(user)
    return user


def count_baseline_attempts(db: Session, user_id: str) -> int:
    stmt = (
        select(func.count(models.Attempt.id))
        .where(models.Attempt.user_id == user_id)
        .where(models.Attempt.baseline_flag.is_(True))
    )
    return int(db.scalar(stmt) or 0)


def count_normal_attempts(db: Session, user_id: str) -> int:
    stmt = (
        select(func.count(models.Attempt.id))
        .where(models.Attempt.user_id == user_id)
        .where(models.Attempt.baseline_flag.is_(False))
    )
    return int(db.scalar(stmt) or 0)


def create_attempt(db: Session, payload: schemas.AttemptCreate) -> models.Attempt:
    baseline_completed = count_baseline_attempts(db, payload.user_id)

    if not payload.baseline_flag and baseline_completed < BASELINE_REQUIRED_ATTEMPTS:
        raise ValueError(
            "Baseline incomplete: "
            f"{baseline_completed}/{BASELINE_REQUIRED_ATTEMPTS} attempts completed."
        )

    attempt_number = (
        baseline_completed + 1
        if payload.baseline_flag
        else count_normal_attempts(db, payload.user_id) + 1
    )

    attempt = models.Attempt(
        user_id=payload.user_id,
        baseline_flag=payload.baseline_flag,
        attempt_number=attempt_number,
        duration_ms=payload.duration_ms,
        success=payload.success,
        summary=payload.summary,
        alcohol_status=payload.alcohol_status,
        sleep_hours=payload.sleep_hours,
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


def get_user_stats(db: Session, user_id: str) -> schemas.UserStatsOut | None:
    user = get_user(db, user_id)
    if user is None:
        return None

    total_attempts = int(
        db.scalar(select(func.count(models.Attempt.id)).where(models.Attempt.user_id == user_id)) or 0
    )
    successful_attempts = int(
        db.scalar(
            select(func.count(models.Attempt.id))
            .where(models.Attempt.user_id == user_id)
            .where(models.Attempt.success.is_(True))
        )
        or 0
    )
    best_duration_ms = db.scalar(
        select(func.min(models.Attempt.duration_ms))
        .where(models.Attempt.user_id == user_id)
        .where(models.Attempt.success.is_(True))
    )

    return schemas.UserStatsOut(
        user_id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        best_duration_ms=best_duration_ms,
        total_attempts=total_attempts,
        successful_attempts=successful_attempts,
    )


def get_leaderboard(db: Session, limit: int = 5) -> list[schemas.LeaderboardEntryOut]:
    stmt = (
        select(
            models.User.first_name,
            models.User.last_name,
            func.min(models.Attempt.duration_ms).label("best_duration_ms"),
        )
        .join(models.Attempt, models.Attempt.user_id == models.User.id)
        .where(models.Attempt.success.is_(True))
        .group_by(models.User.id, models.User.first_name, models.User.last_name)
        .order_by(func.min(models.Attempt.duration_ms).asc(), models.User.last_name.asc(), models.User.first_name.asc())
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    return [
        schemas.LeaderboardEntryOut(
            rank=index + 1,
            first_name=row.first_name,
            last_name=row.last_name,
            best_duration_ms=row.best_duration_ms,
        )
        for index, row in enumerate(rows)
    ]
