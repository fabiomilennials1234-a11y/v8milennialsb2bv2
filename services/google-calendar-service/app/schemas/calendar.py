"""Calendar-related schemas."""

from typing import Optional

from pydantic import BaseModel, Field


class CalendarResponse(BaseModel):
    """Single calendar information."""

    id: str = Field(..., description="Calendar ID")
    summary: str = Field(..., description="Calendar name")
    description: Optional[str] = Field(None, description="Calendar description")
    primary: bool = Field(False, description="Whether this is the primary calendar")
    access_role: str = Field(..., description="User's access role")
    background_color: Optional[str] = Field(None, description="Background color")
    foreground_color: Optional[str] = Field(None, description="Foreground color")


class CalendarListResponse(BaseModel):
    """List of calendars response."""

    calendars: list[CalendarResponse] = Field(
        default_factory=list, description="User's calendars"
    )


class AvailabilitySlot(BaseModel):
    """Time slot for availability."""

    start: str = Field(..., description="Start time (HH:MM)")
    end: str = Field(..., description="End time (HH:MM)")


class AvailabilityResponse(BaseModel):
    """Availability check response."""

    user_id: str = Field(..., description="User ID")
    date: str = Field(..., description="Date checked (YYYY-MM-DD)")
    timezone: str = Field(..., description="Timezone")
    busy_slots: list[AvailabilitySlot] = Field(
        default_factory=list, description="Busy time slots"
    )
    free_slots: list[AvailabilitySlot] = Field(
        default_factory=list, description="Free time slots"
    )
