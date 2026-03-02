from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


GameType = Literal["corner_basket_swipe", "go_no_go_tap_burst", "target_switch_tap"]
AlcoholStatus = Literal["no", "a_couple", "yes"]


class UserCreate(BaseModel):
    device_user_id: str = Field(min_length=8, max_length=64)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)


class UserOut(BaseModel):
    id: str
    device_user_id: str
    first_name: str
    last_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionCreate(BaseModel):
    user_id: str
    baseline_mode: bool = False


class SessionOut(BaseModel):
    id: str
    user_id: str
    baseline_mode: bool
    started_at: datetime
    ended_at: datetime | None

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
    session_id: str | None = None
    game_type: GameType
    baseline_flag: bool
    started_at: datetime
    ended_at: datetime
    duration_ms: int = Field(gt=0)
    success: bool
    summary: dict[str, Any]
    raw_events: list[RawEventIn] = Field(default_factory=list)


class AttemptOut(BaseModel):
    id: str
    user_id: str
    session_id: str | None
    game_type: GameType
    baseline_flag: bool
    attempt_number: int
    started_at: datetime
    ended_at: datetime
    duration_ms: int
    success: bool
    summary: dict[str, Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class BaselineStatusOut(BaseModel):
    user_id: str
    game_type: GameType
    required_attempts: int = 3
    baseline_attempts_completed: int
    baseline_complete: bool


class LabelCreate(BaseModel):
    user_id: str
    session_id: str | None = None
    attempt_id: str | None = None
    alcohol_status: AlcoholStatus
    sleep_hours: float = Field(ge=0, le=24)


class LabelOut(BaseModel):
    id: str
    user_id: str
    session_id: str | None
    attempt_id: str | None
    alcohol_status: AlcoholStatus
    sleep_hours: float
    created_at: datetime

    model_config = {"from_attributes": True}
