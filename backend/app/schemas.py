from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


AlcoholStatus = Literal["no", "a_couple", "yes"]
ScoreMode = Literal["active_ball_time_ms", "duration_ms"]


class UserCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)


class UserOut(BaseModel):
    id: str
    first_name: str
    last_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RawEventIn(BaseModel):
    event_index: int
    t_ms: int
    event_type: str
    x: float | None = None
    y: float | None = None
    force: float | None = None
    radius: float | None = None
    payload: dict[str, Any] | None = None


class AttemptCreate(BaseModel):
    user_id: str
    baseline_flag: bool
    duration_ms: int = Field(gt=0)
    success: bool
    summary: dict[str, Any]
    raw_events: list[RawEventIn] = Field(default_factory=list)
    alcohol_status: AlcoholStatus | None = None
    sleep_hours: float | None = Field(default=None, ge=0, le=24)


class AttemptOut(BaseModel):
    id: str
    user_id: str
    baseline_flag: bool
    attempt_number: int
    duration_ms: int
    success: bool
    summary: dict[str, Any]
    alcohol_status: AlcoholStatus | None
    sleep_hours: float | None

    model_config = {"from_attributes": True}


class BaselineStatusOut(BaseModel):
    user_id: str
    required_attempts: int = 3
    baseline_attempts_completed: int
    baseline_complete: bool


class UserStatsOut(BaseModel):
    user_id: str
    first_name: str
    last_name: str
    best_score: int | None
    total_attempts: int
    successful_attempts: int


class LeaderboardEntryOut(BaseModel):
    rank: int
    first_name: str
    last_name: str
    best_score: int


class ScoreModeOut(BaseModel):
    score_mode: ScoreMode
