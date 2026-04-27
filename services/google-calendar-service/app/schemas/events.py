"""Event-related schemas."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class AttendeeInfo(BaseModel):
    """Attendee information."""

    email: str
    response_status: Optional[str] = None
    organizer: bool = False


class ReminderOverride(BaseModel):
    """Custom reminder configuration."""

    method: str = Field(..., description="Reminder method: email or popup")
    minutes: int = Field(..., description="Minutes before event")


class RemindersConfig(BaseModel):
    """Reminders configuration."""

    use_default: bool = Field(True, description="Use calendar default reminders")
    overrides: list[ReminderOverride] = Field(
        default_factory=list, description="Custom reminder overrides"
    )


class EventResponse(BaseModel):
    """Calendar event response."""

    id: str = Field(..., description="Google event ID")
    summary: str = Field(..., description="Event title")
    description: Optional[str] = Field(None, description="Event description")
    location: Optional[str] = Field(None, description="Event location")
    start: str = Field(..., description="Start datetime (ISO format)")
    end: str = Field(..., description="End datetime (ISO format)")
    timezone: Optional[str] = Field(None, description="Event timezone")
    status: str = Field(..., description="Event status")
    html_link: str = Field(..., description="Link to view in Google Calendar")
    attendees: list[AttendeeInfo] = Field(
        default_factory=list, description="Event attendees"
    )
    created: Optional[str] = Field(None, description="When event was created")
    updated: Optional[str] = Field(None, description="When event was last updated")
    creator: Optional[dict[str, Any]] = Field(None, description="Event creator")
    organizer: Optional[dict[str, Any]] = Field(None, description="Event organizer")


class EventListResponse(BaseModel):
    """List of events response."""

    events: list[EventResponse] = Field(
        default_factory=list, description="Calendar events"
    )


class CreateEventRequest(BaseModel):
    """Request to create a calendar event."""

    summary: str = Field(..., description="Event title")
    start: datetime = Field(..., description="Start datetime")
    end: datetime = Field(..., description="End datetime")
    calendar_id: str = Field("primary", description="Target calendar ID")
    description: Optional[str] = Field(None, description="Event description")
    location: Optional[str] = Field(None, description="Event location")
    attendees: list[str] = Field(
        default_factory=list, description="Attendee email addresses"
    )
    timezone: str = Field("America/Sao_Paulo", description="Event timezone")
    reminders: Optional[RemindersConfig] = Field(
        None, description="Custom reminders configuration"
    )
    send_updates: str = Field(
        "all", description="Notification setting: all, externalOnly, none"
    )


class UpdateEventRequest(BaseModel):
    """Request to update a calendar event."""

    summary: Optional[str] = Field(None, description="New event title")
    start: Optional[datetime] = Field(None, description="New start datetime")
    end: Optional[datetime] = Field(None, description="New end datetime")
    description: Optional[str] = Field(None, description="New description")
    location: Optional[str] = Field(None, description="New location")
    attendees: Optional[list[str]] = Field(None, description="New attendee list")
    timezone: str = Field("America/Sao_Paulo", description="Timezone for datetime")
    send_updates: str = Field(
        "all", description="Notification setting: all, externalOnly, none"
    )


class DeleteEventRequest(BaseModel):
    """Request to delete a calendar event."""

    send_updates: str = Field(
        "all", description="Notification setting: all, externalOnly, none"
    )


# Internal API schemas (for AI agents)


class InternalEventMetadata(BaseModel):
    """Metadata for AI agent operations."""

    source: str = Field("ai_agent", description="Operation source")
    agent_id: Optional[str] = Field(None, description="AI agent ID")
    reference_type: Optional[str] = Field(
        None, description="Local entity type: pipe_confirmacao, follow_up"
    )
    reference_id: Optional[str] = Field(None, description="Local entity ID")


class InternalCreateEventRequest(BaseModel):
    """Internal request to create event on behalf of user."""

    user_id: str = Field(..., description="User ID to create event for")
    calendar_id: str = Field("primary", description="Target calendar ID")
    event: CreateEventRequest = Field(..., description="Event details")
    metadata: InternalEventMetadata = Field(
        default_factory=InternalEventMetadata, description="Operation metadata"
    )


class InternalUpdateEventRequest(BaseModel):
    """Internal request to update event on behalf of user."""

    user_id: str = Field(..., description="User ID")
    updates: UpdateEventRequest = Field(..., description="Fields to update")


class InternalDeleteEventRequest(BaseModel):
    """Internal request to delete event on behalf of user."""

    user_id: str = Field(..., description="User ID")
    send_updates: str = Field("all", description="Notification setting")


class InternalEventResponse(BaseModel):
    """Internal API event response."""

    success: bool
    event_id: Optional[str] = None
    html_link: Optional[str] = None
    error: Optional[str] = None
