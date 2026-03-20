from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models, schemas

BASELINE_REQUIRED_ATTEMPTS = 3
DEFAULT_SCORE_MODE = "active_ball_time_ms"


def get_score_mode(db: Session) -> str:
    setting = db.get(models.AppSetting, "score_mode")
    if setting is None:
        return DEFAULT_SCORE_MODE
    return setting.value


def set_score_mode(db: Session, score_mode: str) -> str:
    setting = db.get(models.AppSetting, "score_mode")
    if setting is None:
        setting = models.AppSetting(key="score_mode", value=score_mode)
        db.add(setting)
    else:
        setting.value = score_mode
    db.commit()
    return score_mode


def _attempt_score_ms(attempt: models.Attempt, score_mode: str) -> int | None:
    if score_mode == "duration_ms":
        return attempt.duration_ms
    if isinstance(attempt.summary, dict):
        score = attempt.summary.get("active_ball_time_ms")
        if isinstance(score, int):
            return score
    return attempt.duration_ms


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
    score_mode = get_score_mode(db)
    successful_attempts_rows = db.scalars(
        select(models.Attempt)
        .where(models.Attempt.user_id == user_id)
        .where(models.Attempt.success.is_(True))
    ).all()
    scores = [score for attempt in successful_attempts_rows if (score := _attempt_score_ms(attempt, score_mode)) is not None]
    best_score_ms = min(scores) if scores else None

    return schemas.UserStatsOut(
        user_id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        best_score_ms=best_score_ms,
        total_attempts=total_attempts,
        successful_attempts=successful_attempts,
    )


def get_leaderboard(db: Session, limit: int = 5) -> list[schemas.LeaderboardEntryOut]:
    score_mode = get_score_mode(db)
    users = db.scalars(select(models.User)).all()
    rows: list[tuple[str, str, int]] = []
    for user in users:
        attempts = db.scalars(
            select(models.Attempt)
            .where(models.Attempt.user_id == user.id)
            .where(models.Attempt.success.is_(True))
        ).all()
        scores = [score for attempt in attempts if (score := _attempt_score_ms(attempt, score_mode)) is not None]
        if scores:
            rows.append((user.first_name, user.last_name, min(scores)))

    rows.sort(key=lambda row: (row[2], row[1].lower(), row[0].lower()))
    rows = rows[:limit]
    return [
        schemas.LeaderboardEntryOut(
            rank=index + 1,
            first_name=row[0],
            last_name=row[1],
            best_score_ms=row[2],
        )
        for index, row in enumerate(rows)
    ]
