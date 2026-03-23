from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models, schemas

BASELINE_REQUIRED_ATTEMPTS = 3
DEFAULT_SCORE_MODE = "active_ball_time_ms"
SCORE_MAX_POINTS = 1000


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


def _attempt_raw_score_ms(attempt: models.Attempt, score_mode: str) -> int | None:
    summary = attempt.summary if isinstance(attempt.summary, dict) else {}
    if score_mode == "duration_ms":
        score = summary.get("completion_score_ms")
        if isinstance(score, int):
            return score
        penalty = summary.get("missed_tap_penalty_ms")
        if isinstance(penalty, int):
            return attempt.duration_ms + penalty
        return attempt.duration_ms

    score = summary.get("score_ms")
    if isinstance(score, int):
        return score
    score = summary.get("active_ball_time_ms")
    if isinstance(score, int):
        return score
    return attempt.duration_ms


def _average_first_touch_ms(summary: dict | None) -> int:
    if not isinstance(summary, dict):
        return 0
    per_ball = summary.get("per_ball")
    if not isinstance(per_ball, dict):
        return 0
    values: list[int] = []
    for item in per_ball.values():
        if isinstance(item, dict):
            value = item.get("first_touch_ms")
            if isinstance(value, int):
                values.append(value)
    if not values:
        return 0
    return round(sum(values) / len(values))


def _saved_score_points(summary: dict | None) -> int | None:
    if not isinstance(summary, dict):
        return None
    value = summary.get("score_points")
    if isinstance(value, int):
        return value
    return None


def _score_points(attempt: models.Attempt, score_mode: str) -> int | None:
    saved_points = _saved_score_points(attempt.summary if isinstance(attempt.summary, dict) else None)
    if saved_points is not None:
        return saved_points

    raw_score_ms = _attempt_raw_score_ms(attempt, score_mode)
    if raw_score_ms is None:
        return None
    summary = attempt.summary if isinstance(attempt.summary, dict) else {}
    empty_taps = summary.get("empty_taps") if isinstance(summary.get("empty_taps"), int) else 0
    avg_first_touch_ms = _average_first_touch_ms(summary)

    speed_component = max(0, 700 - round(raw_score_ms / 25))
    control_component = max(0, 300 - (empty_taps * 25) - round(avg_first_touch_ms / 25))
    return max(0, min(SCORE_MAX_POINTS, speed_component + control_component))


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
    scores = [score for attempt in successful_attempts_rows if (score := _score_points(attempt, score_mode)) is not None]
    best_score = max(scores) if scores else None

    return schemas.UserStatsOut(
        user_id=user.id,
        first_name=user.first_name,
        last_name=user.last_name,
        best_score=best_score,
        total_attempts=total_attempts,
        successful_attempts=successful_attempts,
    )


def get_leaderboard(db: Session, limit: int = 10) -> list[schemas.LeaderboardEntryOut]:
    score_mode = get_score_mode(db)
    users = db.scalars(select(models.User)).all()
    rows: list[tuple[str, str, int]] = []
    for user in users:
        attempts = db.scalars(
            select(models.Attempt)
            .where(models.Attempt.user_id == user.id)
            .where(models.Attempt.success.is_(True))
        ).all()
        scores = [score for attempt in attempts if (score := _score_points(attempt, score_mode)) is not None]
        if scores:
            rows.append((user.first_name, user.last_name, max(scores)))

    rows.sort(key=lambda row: (-row[2], row[1].lower(), row[0].lower()))
    rows = rows[:limit]
    return [
        schemas.LeaderboardEntryOut(
            rank=index + 1,
            first_name=row[0],
            last_name=row[1],
            best_score=row[2],
        )
        for index, row in enumerate(rows)
    ]
