"""Internal API routes for AI agent consumption."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Path, Query

from app.api.calendar.service import CalendarService
from app.api.deps import (
    get_encryptor,
    get_sync_log_repository,
    get_token_repository,
    verify_internal_api_key,
)
from app.config import Settings, get_settings
from app.core.exceptions import CalendarServiceError
from app.core.security import TokenEncryptor
from app.db.repositories import SyncLogRepository, TokenRepository
from app.schemas.calendar import AvailabilityResponse
from app.schemas.events import (
    CreateEventRequest,
    InternalCreateEventRequest,
    InternalDeleteEventRequest,
    InternalEventResponse,
    InternalUpdateEventRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal/calendar",
    tags=["Internal API"],
    dependencies=[Depends(verify_internal_api_key)],
)


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


@router.post("/events", response_model=InternalEventResponse)
async def create_event_for_user(
    request: InternalCreateEventRequest,
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Create a calendar event on behalf of a user.

    This endpoint is designed for AI agents to create events.
    Requires X-API-Key authentication.
    """
    try:
        event = await service.create_event(
            user_id=request.user_id,
            request=request.event,
            initiated_by=request.metadata.source,
            agent_id=request.metadata.agent_id,
            reference_type=request.metadata.reference_type,
            reference_id=request.metadata.reference_id,
        )

        return InternalEventResponse(
            success=True,
            event_id=event.id,
            html_link=event.html_link,
        )

    except CalendarServiceError as e:
        logger.error(f"Failed to create event for user {request.user_id}: {e}")
        return InternalEventResponse(
            success=False,
            error=e.message,
        )

    except Exception as e:
        logger.exception(f"Unexpected error creating event: {e}")
        return InternalEventResponse(
            success=False,
            error=str(e),
        )


@router.put("/events/{event_id}", response_model=InternalEventResponse)
async def update_event_for_user(
    event_id: str = Path(..., description="Google event ID"),
    request: InternalUpdateEventRequest = ...,
    calendar_id: str = Query("primary", description="Calendar ID"),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Update a calendar event on behalf of a user.

    This endpoint is designed for AI agents to update events.
    Requires X-API-Key authentication.
    """
    try:
        event = await service.update_event(
            user_id=request.user_id,
            event_id=event_id,
            request=request.updates,
            calendar_id=calendar_id,
            initiated_by="ai_agent",
        )

        return InternalEventResponse(
            success=True,
            event_id=event.id,
            html_link=event.html_link,
        )

    except CalendarServiceError as e:
        logger.error(f"Failed to update event {event_id}: {e}")
        return InternalEventResponse(
            success=False,
            error=e.message,
        )

    except Exception as e:
        logger.exception(f"Unexpected error updating event: {e}")
        return InternalEventResponse(
            success=False,
            error=str(e),
        )


@router.delete("/events/{event_id}", response_model=InternalEventResponse)
async def delete_event_for_user(
    event_id: str = Path(..., description="Google event ID"),
    request: InternalDeleteEventRequest = ...,
    calendar_id: str = Query("primary", description="Calendar ID"),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Delete a calendar event on behalf of a user.

    This endpoint is designed for AI agents to delete events.
    Requires X-API-Key authentication.
    """
    try:
        await service.delete_event(
            user_id=request.user_id,
            event_id=event_id,
            calendar_id=calendar_id,
            send_updates=request.send_updates,
            initiated_by="ai_agent",
        )

        return InternalEventResponse(
            success=True,
            event_id=event_id,
        )

    except CalendarServiceError as e:
        logger.error(f"Failed to delete event {event_id}: {e}")
        return InternalEventResponse(
            success=False,
            error=e.message,
        )

    except Exception as e:
        logger.exception(f"Unexpected error deleting event: {e}")
        return InternalEventResponse(
            success=False,
            error=str(e),
        )


@router.get("/availability/{user_id}", response_model=AvailabilityResponse)
async def get_user_availability(
    user_id: str = Path(..., description="User ID to check availability for"),
    date: str = Query(..., description="Date to check (YYYY-MM-DD)"),
    timezone: str = Query("America/Sao_Paulo", description="Timezone"),
    work_start: str = Query("09:00", description="Working hours start (HH:MM)"),
    work_end: str = Query("18:00", description="Working hours end (HH:MM)"),
    service: CalendarService = Depends(get_calendar_service),
):
    """
    Get user's calendar availability for a specific date.

    This endpoint is designed for AI agents to check availability
    before scheduling meetings. Requires X-API-Key authentication.

    Returns busy and free time slots within working hours.
    """
    return await service.get_availability(
        user_id=user_id,
        date=date,
        timezone=timezone,
        work_start=work_start,
        work_end=work_end,
    )


@router.get("/connection/{user_id}")
async def check_user_connection(
    user_id: str = Path(..., description="User ID to check"),
    token_repo: TokenRepository = Depends(get_token_repository),
):
    """
    Check if a user has connected their Google Calendar.

    This endpoint is designed for AI agents to verify calendar
    connection before attempting operations.
    Requires X-API-Key authentication.
    """
    token = await token_repo.get_by_user_id(user_id)

    if not token:
        return {
            "connected": False,
            "user_id": user_id,
            "message": "User has not connected Google Calendar",
        }

    return {
        "connected": True,
        "user_id": user_id,
        "google_email": token.google_email,
        "is_active": token.is_active,
        "last_sync": token.last_sync_at,
        "last_error": token.last_error,
    }
