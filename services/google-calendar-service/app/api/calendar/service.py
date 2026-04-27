"""Calendar operations service."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import Settings
from app.core.exceptions import CalendarNotConnectedError, TokenExpiredError
from app.core.google_client import GoogleCalendarClient
from app.core.security import TokenEncryptor
from app.db.models import CalendarSyncLogCreate
from app.db.repositories import SyncLogRepository, TokenRepository
from app.schemas.calendar import (
    AvailabilityResponse,
    AvailabilitySlot,
    CalendarListResponse,
    CalendarResponse,
)
from app.schemas.events import (
    CreateEventRequest,
    EventListResponse,
    EventResponse,
    UpdateEventRequest,
)

logger = logging.getLogger(__name__)


class CalendarService:
    """Service for Google Calendar operations."""

    def __init__(
        self,
        settings: Settings,
        token_repo: TokenRepository,
        sync_log_repo: SyncLogRepository,
        encryptor: TokenEncryptor,
    ):
        """Initialize calendar service."""
        self.settings = settings
        self.token_repo = token_repo
        self.sync_log_repo = sync_log_repo
        self.encryptor = encryptor

    async def _get_calendar_client(
        self,
        user_id: str,
    ) -> GoogleCalendarClient:
        """
        Get authenticated calendar client for a user.

        Args:
            user_id: User ID

        Returns:
            Authenticated GoogleCalendarClient

        Raises:
            CalendarNotConnectedError: If user hasn't connected calendar
            TokenExpiredError: If token refresh fails
        """
        token = await self.token_repo.get_by_user_id(user_id)

        if not token:
            raise CalendarNotConnectedError(user_id)

        # Decrypt refresh token
        refresh_token = self.encryptor.decrypt(
            token.encrypted_refresh_token,
            token.encryption_nonce,
        )

        # Create token refresh callback
        async def on_token_refresh(access_token: str, expires_at: datetime):
            await self.token_repo.update_expiry(user_id, expires_at)

        # For now, we need to get a fresh access token using refresh token
        # In production, you might cache access tokens
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        credentials = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=self.settings.google_client_id,
            client_secret=self.settings.google_client_secret,
            scopes=self.settings.google_scopes,
        )

        try:
            credentials.refresh(Request())
        except Exception as e:
            logger.error(f"Token refresh failed for user {user_id}: {e}")
            await self.token_repo.set_error(user_id, str(e))
            raise TokenExpiredError(user_id, "Failed to refresh access token")

        # Update expiry in database
        if credentials.expiry:
            await self.token_repo.update_expiry(user_id, credentials.expiry)

        return GoogleCalendarClient(
            access_token=credentials.token,
            refresh_token=refresh_token,
            settings=self.settings,
            user_id=user_id,
            on_token_refresh=on_token_refresh,
        )

    async def list_calendars(self, user_id: str) -> CalendarListResponse:
        """
        List user's Google calendars.

        Args:
            user_id: User ID

        Returns:
            List of calendars
        """
        client = await self._get_calendar_client(user_id)
        calendars = client.list_calendars()

        return CalendarListResponse(
            calendars=[CalendarResponse(**cal) for cal in calendars]
        )

    async def list_events(
        self,
        user_id: str,
        calendar_id: str = "primary",
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        max_results: int = 50,
    ) -> EventListResponse:
        """
        List events from a calendar.

        Args:
            user_id: User ID
            calendar_id: Calendar ID (default: primary)
            start: Start of time range
            end: End of time range
            max_results: Maximum events to return

        Returns:
            List of events
        """
        client = await self._get_calendar_client(user_id)

        events = client.list_events(
            calendar_id=calendar_id,
            time_min=start,
            time_max=end,
            max_results=max_results,
        )

        return EventListResponse(
            events=[EventResponse(**event) for event in events]
        )

    async def get_event(
        self,
        user_id: str,
        event_id: str,
        calendar_id: str = "primary",
    ) -> EventResponse:
        """
        Get a single event.

        Args:
            user_id: User ID
            event_id: Google event ID
            calendar_id: Calendar ID

        Returns:
            Event details
        """
        client = await self._get_calendar_client(user_id)
        event = client.get_event(event_id, calendar_id)
        return EventResponse(**event)

    async def create_event(
        self,
        user_id: str,
        request: CreateEventRequest,
        initiated_by: str = "user",
        agent_id: Optional[str] = None,
        reference_type: Optional[str] = None,
        reference_id: Optional[str] = None,
    ) -> EventResponse:
        """
        Create a calendar event.

        Args:
            user_id: User ID
            request: Event creation request
            initiated_by: Who initiated ('user', 'ai_agent', 'system')
            agent_id: AI agent ID if applicable
            reference_type: Local entity type
            reference_id: Local entity ID

        Returns:
            Created event
        """
        client = await self._get_calendar_client(user_id)

        reminders = None
        if request.reminders:
            reminders = {
                "useDefault": request.reminders.use_default,
                "overrides": [
                    {"method": r.method, "minutes": r.minutes}
                    for r in request.reminders.overrides
                ],
            }

        event = client.create_event(
            summary=request.summary,
            start=request.start,
            end=request.end,
            calendar_id=request.calendar_id,
            description=request.description,
            location=request.location,
            attendees=request.attendees,
            timezone=request.timezone,
            reminders=reminders,
            send_updates=request.send_updates,
        )

        # Log the operation
        await self.sync_log_repo.create(
            CalendarSyncLogCreate(
                user_id=user_id,
                operation="create_event",
                google_event_id=event["id"],
                local_reference_type=reference_type,
                local_reference_id=reference_id,
                status="success",
                request_payload=request.model_dump(),
                response_payload=event,
                initiated_by=initiated_by,
                agent_id=agent_id,
            )
        )

        return EventResponse(**event)

    async def update_event(
        self,
        user_id: str,
        event_id: str,
        request: UpdateEventRequest,
        calendar_id: str = "primary",
        initiated_by: str = "user",
        agent_id: Optional[str] = None,
    ) -> EventResponse:
        """
        Update a calendar event.

        Args:
            user_id: User ID
            event_id: Google event ID
            request: Update request
            calendar_id: Calendar ID
            initiated_by: Who initiated the update
            agent_id: AI agent ID if applicable

        Returns:
            Updated event
        """
        client = await self._get_calendar_client(user_id)

        updates = request.model_dump(exclude_none=True, exclude={"send_updates"})

        event = client.update_event(
            event_id=event_id,
            calendar_id=calendar_id,
            send_updates=request.send_updates,
            **updates,
        )

        # Log the operation
        await self.sync_log_repo.create(
            CalendarSyncLogCreate(
                user_id=user_id,
                operation="update_event",
                google_event_id=event_id,
                status="success",
                request_payload={"event_id": event_id, **request.model_dump()},
                response_payload=event,
                initiated_by=initiated_by,
                agent_id=agent_id,
            )
        )

        return EventResponse(**event)

    async def delete_event(
        self,
        user_id: str,
        event_id: str,
        calendar_id: str = "primary",
        send_updates: str = "all",
        initiated_by: str = "user",
        agent_id: Optional[str] = None,
    ) -> bool:
        """
        Delete a calendar event.

        Args:
            user_id: User ID
            event_id: Google event ID
            calendar_id: Calendar ID
            send_updates: Notification setting
            initiated_by: Who initiated the deletion
            agent_id: AI agent ID if applicable

        Returns:
            True if deleted successfully
        """
        client = await self._get_calendar_client(user_id)

        result = client.delete_event(
            event_id=event_id,
            calendar_id=calendar_id,
            send_updates=send_updates,
        )

        # Log the operation
        await self.sync_log_repo.create(
            CalendarSyncLogCreate(
                user_id=user_id,
                operation="delete_event",
                google_event_id=event_id,
                status="success",
                request_payload={
                    "event_id": event_id,
                    "calendar_id": calendar_id,
                    "send_updates": send_updates,
                },
                initiated_by=initiated_by,
                agent_id=agent_id,
            )
        )

        return result

    async def get_availability(
        self,
        user_id: str,
        date: str,
        timezone: str = "America/Sao_Paulo",
        work_start: str = "09:00",
        work_end: str = "18:00",
    ) -> AvailabilityResponse:
        """
        Get availability (free/busy) for a specific date.

        Args:
            user_id: User ID
            date: Date to check (YYYY-MM-DD)
            timezone: Timezone
            work_start: Working hours start (HH:MM)
            work_end: Working hours end (HH:MM)

        Returns:
            Availability with busy and free slots
        """
        client = await self._get_calendar_client(user_id)

        # Parse date and create time range
        from datetime import datetime as dt
        import pytz

        tz = pytz.timezone(timezone)
        date_obj = dt.strptime(date, "%Y-%m-%d")

        work_start_h, work_start_m = map(int, work_start.split(":"))
        work_end_h, work_end_m = map(int, work_end.split(":"))

        time_min = tz.localize(date_obj.replace(hour=work_start_h, minute=work_start_m))
        time_max = tz.localize(date_obj.replace(hour=work_end_h, minute=work_end_m))

        # Get free/busy info
        busy_info = client.get_freebusy(
            time_min=time_min,
            time_max=time_max,
            timezone=timezone,
        )

        # Parse busy slots
        busy_slots = []
        for slot in busy_info.get("primary", []):
            start = dt.fromisoformat(slot["start"].replace("Z", "+00:00"))
            end = dt.fromisoformat(slot["end"].replace("Z", "+00:00"))
            start_local = start.astimezone(tz)
            end_local = end.astimezone(tz)
            busy_slots.append(
                AvailabilitySlot(
                    start=start_local.strftime("%H:%M"),
                    end=end_local.strftime("%H:%M"),
                )
            )

        # Calculate free slots
        free_slots = self._calculate_free_slots(
            busy_slots,
            work_start,
            work_end,
        )

        return AvailabilityResponse(
            user_id=user_id,
            date=date,
            timezone=timezone,
            busy_slots=busy_slots,
            free_slots=free_slots,
        )

    def _calculate_free_slots(
        self,
        busy_slots: list[AvailabilitySlot],
        work_start: str,
        work_end: str,
    ) -> list[AvailabilitySlot]:
        """Calculate free slots from busy slots within work hours."""
        if not busy_slots:
            return [AvailabilitySlot(start=work_start, end=work_end)]

        # Sort busy slots by start time
        sorted_busy = sorted(busy_slots, key=lambda x: x.start)

        free_slots = []
        current_start = work_start

        for busy in sorted_busy:
            if busy.start > current_start:
                free_slots.append(
                    AvailabilitySlot(start=current_start, end=busy.start)
                )
            current_start = max(current_start, busy.end)

        # Add final slot if there's time after last busy slot
        if current_start < work_end:
            free_slots.append(
                AvailabilitySlot(start=current_start, end=work_end)
            )

        return free_slots
