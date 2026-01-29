"""Calendar operations routes."""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.api.calendar.service import CalendarService
from app.api.deps import (
    get_current_user,
    get_encryptor,
    get_sync_log_repository,
    get_token_repository,
)
from app.config import Settings, get_settings
from app.core.security import TokenEncryptor
from app.db.repositories import SyncLogRepository, TokenRepository
from app.schemas.calendar import CalendarListResponse
from app.schemas.events import (
    CreateEventRequest,
    EventListResponse,
    EventResponse,
    UpdateEventRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/calendar", tags=["Calendar"])


def get_calendar_service(
    settings: Settings = Depends(get_settings),
    token_repo: TokenRepository = Depends(get_token_repository),
    sync_log_repo: SyncLogRepository = Depends(get_sync_log_repository),
    encryptor: TokenEncryptor = Depends(get_encryptor),
) -> CalendarService:
    """Build CalendarService with dependencies."""
    return CalendarService(
        settings=settings,
        token_repo=token_repo,
        sync_log_repo=sync_log_repo,
        encryptor=encryptor,
    )


@router.get("/calendars", response_model=CalendarListResponse)
async def list_calendars(
    user_id: str = Depends(get_current_user),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    List user's Google calendars.

    Returns all calendars the user has access to.
    """
    return await service.list_calendars(user_id)


@router.get("/events", response_model=EventListResponse)
async def list_events(
    calendar_id: str = Query("primary", description="Calendar ID"),
    start: Optional[datetime] = Query(None, description="Start of time range"),
    end: Optional[datetime] = Query(None, description="End of time range"),
    max_results: int = Query(50, ge=1, le=250, description="Maximum events"),
    user_id: str = Depends(get_current_user),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    List events from a calendar.

    Returns events within the specified time range.
    """
    return await service.list_events(
        user_id=user_id,
        calendar_id=calendar_id,
        start=start,
        end=end,
        max_results=max_results,
    )


@router.get("/events/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: str,
    calendar_id: str = Query("primary", description="Calendar ID"),
    user_id: str = Depends(get_current_user),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Get a single event.

    Returns event details by ID.
    """
    return await service.get_event(
        user_id=user_id,
        event_id=event_id,
        calendar_id=calendar_id,
    )


@router.post("/events", response_model=EventResponse)
async def create_event(
    request: CreateEventRequest,
    user_id: str = Depends(get_current_user),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Create a calendar event.

    Creates a new event on the user's calendar.
    """
    return await service.create_event(
        user_id=user_id,
        request=request,
        initiated_by="user",
    )


@router.put("/events/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: str,
    request: UpdateEventRequest,
    calendar_id: str = Query("primary", description="Calendar ID"),
    user_id: str = Depends(get_current_user),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Update a calendar event.

    Updates an existing event on the user's calendar.
    """
    return await service.update_event(
        user_id=user_id,
        event_id=event_id,
        request=request,
        calendar_id=calendar_id,
        initiated_by="user",
    )


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: str,
    calendar_id: str = Query("primary", description="Calendar ID"),
    send_updates: str = Query("all", description="Notification setting"),
    user_id: str = Depends(get_current_user),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Delete a calendar event.

    Removes an event from the user's calendar.
    """
    await service.delete_event(
        user_id=user_id,
        event_id=event_id,
        calendar_id=calendar_id,
        send_updates=send_updates,
        initiated_by="user",
    )
    return {"success": True, "message": "Event deleted"}
