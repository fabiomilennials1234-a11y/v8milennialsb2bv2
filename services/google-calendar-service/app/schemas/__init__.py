"""Pydantic schemas for request/response validation."""

from app.schemas.auth import (
    AuthorizationUrlResponse,
    ConnectionStatusResponse,
    RevokeResponse,
)
from app.schemas.calendar import (
    CalendarListResponse,
    CalendarResponse,
)
from app.schemas.events import (
    CreateEventRequest,
    EventListResponse,
    EventResponse,
    UpdateEventRequest,
)

__all__ = [
    "AuthorizationUrlResponse",
    "ConnectionStatusResponse",
    "RevokeResponse",
    "CalendarListResponse",
    "CalendarResponse",
    "CreateEventRequest",
    "UpdateEventRequest",
    "EventResponse",
    "EventListResponse",
]
