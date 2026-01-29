"""Google Calendar API client wrapper."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.config import Settings
from app.core.exceptions import GoogleAPIError, TokenExpiredError

logger = logging.getLogger(__name__)


class GoogleOAuthFlow:
    """Manages Google OAuth 2.0 authorization flow."""

    def __init__(self, settings: Settings):
        """Initialize OAuth flow with settings."""
        self.settings = settings
        self.client_config = {
            "web": {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uris": [settings.google_redirect_uri],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

    def get_authorization_url(self, state: str) -> str:
        """
        Generate Google OAuth authorization URL.

        Args:
            state: CSRF protection state parameter

        Returns:
            Authorization URL for user to visit
        """
        flow = Flow.from_client_config(
            self.client_config,
            scopes=self.settings.google_scopes,
            redirect_uri=self.settings.google_redirect_uri,
        )

        authorization_url, _ = flow.authorization_url(
            access_type="offline",  # Get refresh token
            include_granted_scopes="true",
            prompt="consent",  # Always show consent to get refresh token
            state=state,
        )

        return authorization_url

    def exchange_code(self, code: str) -> dict[str, Any]:
        """
        Exchange authorization code for tokens.

        Args:
            code: Authorization code from callback

        Returns:
            Dictionary with tokens and metadata
        """
        flow = Flow.from_client_config(
            self.client_config,
            scopes=self.settings.google_scopes,
            redirect_uri=self.settings.google_redirect_uri,
        )

        flow.fetch_token(code=code)
        credentials = flow.credentials

        return {
            "access_token": credentials.token,
            "refresh_token": credentials.refresh_token,
            "expires_at": credentials.expiry,
            "scopes": list(credentials.scopes) if credentials.scopes else [],
        }


class GoogleCalendarClient:
    """Client for Google Calendar API operations."""

    def __init__(
        self,
        access_token: str,
        refresh_token: str,
        settings: Settings,
        user_id: str,
        on_token_refresh: Optional[callable] = None,
    ):
        """
        Initialize Calendar client.

        Args:
            access_token: Current access token
            refresh_token: Refresh token for renewal
            settings: Application settings
            user_id: User ID for error context
            on_token_refresh: Callback when token is refreshed
        """
        self.settings = settings
        self.user_id = user_id
        self.on_token_refresh = on_token_refresh

        self.credentials = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            scopes=settings.google_scopes,
        )

        self._service = None

    @property
    def service(self):
        """Get or create Calendar API service."""
        if self._service is None:
            self._service = build("calendar", "v3", credentials=self.credentials)
        return self._service

    def _handle_api_error(self, e: HttpError) -> None:
        """Convert Google API errors to our exceptions."""
        error_content = e.error_details[0] if e.error_details else {}
        reason = error_content.get("reason", "unknown")

        if e.resp.status == 401:
            raise TokenExpiredError(self.user_id, "Access token expired or revoked")

        raise GoogleAPIError(
            message=str(e),
            google_error_code=e.resp.status,
            google_error_reason=reason,
        )

    async def refresh_if_needed(self) -> bool:
        """
        Refresh access token if expired.

        Returns:
            True if token was refreshed
        """
        if self.credentials.expired and self.credentials.refresh_token:
            try:
                from google.auth.transport.requests import Request

                self.credentials.refresh(Request())

                if self.on_token_refresh:
                    await self.on_token_refresh(
                        self.credentials.token,
                        self.credentials.expiry,
                    )

                # Rebuild service with new credentials
                self._service = None
                return True
            except Exception as e:
                logger.error(f"Token refresh failed for user {self.user_id}: {e}")
                raise TokenExpiredError(self.user_id, "Failed to refresh token")
        return False

    def list_calendars(self) -> list[dict[str, Any]]:
        """
        List user's calendars.

        Returns:
            List of calendar dictionaries
        """
        try:
            result = self.service.calendarList().list().execute()
            calendars = []

            for item in result.get("items", []):
                calendars.append(
                    {
                        "id": item["id"],
                        "summary": item.get("summary", ""),
                        "description": item.get("description", ""),
                        "primary": item.get("primary", False),
                        "access_role": item.get("accessRole", ""),
                        "background_color": item.get("backgroundColor", ""),
                        "foreground_color": item.get("foregroundColor", ""),
                    }
                )

            return calendars
        except HttpError as e:
            self._handle_api_error(e)

    def list_events(
        self,
        calendar_id: str = "primary",
        time_min: Optional[datetime] = None,
        time_max: Optional[datetime] = None,
        max_results: int = 50,
        single_events: bool = True,
    ) -> list[dict[str, Any]]:
        """
        List events from a calendar.

        Args:
            calendar_id: Calendar ID (default: primary)
            time_min: Start of time range
            time_max: End of time range
            max_results: Maximum events to return
            single_events: Expand recurring events

        Returns:
            List of event dictionaries
        """
        try:
            if time_min is None:
                time_min = datetime.now(timezone.utc)
            if time_max is None:
                time_max = time_min + timedelta(days=30)

            result = (
                self.service.events()
                .list(
                    calendarId=calendar_id,
                    timeMin=time_min.isoformat(),
                    timeMax=time_max.isoformat(),
                    maxResults=max_results,
                    singleEvents=single_events,
                    orderBy="startTime",
                )
                .execute()
            )

            events = []
            for item in result.get("items", []):
                events.append(self._parse_event(item))

            return events
        except HttpError as e:
            self._handle_api_error(e)

    def get_event(self, event_id: str, calendar_id: str = "primary") -> dict[str, Any]:
        """
        Get a single event.

        Args:
            event_id: Google event ID
            calendar_id: Calendar ID

        Returns:
            Event dictionary
        """
        try:
            result = (
                self.service.events()
                .get(calendarId=calendar_id, eventId=event_id)
                .execute()
            )
            return self._parse_event(result)
        except HttpError as e:
            self._handle_api_error(e)

    def create_event(
        self,
        summary: str,
        start: datetime,
        end: datetime,
        calendar_id: str = "primary",
        description: Optional[str] = None,
        location: Optional[str] = None,
        attendees: Optional[list[str]] = None,
        timezone: str = "America/Sao_Paulo",
        reminders: Optional[dict] = None,
        send_updates: str = "all",
    ) -> dict[str, Any]:
        """
        Create a calendar event.

        Args:
            summary: Event title
            start: Start datetime
            end: End datetime
            calendar_id: Target calendar
            description: Event description
            location: Event location
            attendees: List of attendee emails
            timezone: Timezone for the event
            reminders: Custom reminders configuration
            send_updates: "all", "externalOnly", or "none"

        Returns:
            Created event dictionary
        """
        try:
            event_body = {
                "summary": summary,
                "start": {
                    "dateTime": start.isoformat(),
                    "timeZone": timezone,
                },
                "end": {
                    "dateTime": end.isoformat(),
                    "timeZone": timezone,
                },
            }

            if description:
                event_body["description"] = description
            if location:
                event_body["location"] = location
            if attendees:
                event_body["attendees"] = [{"email": email} for email in attendees]
            if reminders:
                event_body["reminders"] = reminders

            result = (
                self.service.events()
                .insert(
                    calendarId=calendar_id,
                    body=event_body,
                    sendUpdates=send_updates,
                )
                .execute()
            )

            return self._parse_event(result)
        except HttpError as e:
            self._handle_api_error(e)

    def update_event(
        self,
        event_id: str,
        calendar_id: str = "primary",
        send_updates: str = "all",
        **updates,
    ) -> dict[str, Any]:
        """
        Update an existing event.

        Args:
            event_id: Google event ID
            calendar_id: Calendar ID
            send_updates: Notification setting
            **updates: Fields to update (summary, start, end, description, etc.)

        Returns:
            Updated event dictionary
        """
        try:
            # Get current event
            event = (
                self.service.events()
                .get(calendarId=calendar_id, eventId=event_id)
                .execute()
            )

            # Apply updates
            if "summary" in updates:
                event["summary"] = updates["summary"]
            if "description" in updates:
                event["description"] = updates["description"]
            if "location" in updates:
                event["location"] = updates["location"]
            if "start" in updates:
                tz = updates.get("timezone", "America/Sao_Paulo")
                event["start"] = {
                    "dateTime": updates["start"].isoformat(),
                    "timeZone": tz,
                }
            if "end" in updates:
                tz = updates.get("timezone", "America/Sao_Paulo")
                event["end"] = {
                    "dateTime": updates["end"].isoformat(),
                    "timeZone": tz,
                }
            if "attendees" in updates:
                event["attendees"] = [{"email": e} for e in updates["attendees"]]

            result = (
                self.service.events()
                .update(
                    calendarId=calendar_id,
                    eventId=event_id,
                    body=event,
                    sendUpdates=send_updates,
                )
                .execute()
            )

            return self._parse_event(result)
        except HttpError as e:
            self._handle_api_error(e)

    def delete_event(
        self,
        event_id: str,
        calendar_id: str = "primary",
        send_updates: str = "all",
    ) -> bool:
        """
        Delete an event.

        Args:
            event_id: Google event ID
            calendar_id: Calendar ID
            send_updates: Notification setting

        Returns:
            True if deleted successfully
        """
        try:
            self.service.events().delete(
                calendarId=calendar_id,
                eventId=event_id,
                sendUpdates=send_updates,
            ).execute()
            return True
        except HttpError as e:
            self._handle_api_error(e)

    def get_freebusy(
        self,
        time_min: datetime,
        time_max: datetime,
        calendar_ids: Optional[list[str]] = None,
        timezone: str = "America/Sao_Paulo",
    ) -> dict[str, list[dict]]:
        """
        Get free/busy information.

        Args:
            time_min: Start of query range
            time_max: End of query range
            calendar_ids: Calendars to check (default: primary)
            timezone: Timezone for response

        Returns:
            Dictionary mapping calendar IDs to busy slots
        """
        try:
            if calendar_ids is None:
                calendar_ids = ["primary"]

            body = {
                "timeMin": time_min.isoformat(),
                "timeMax": time_max.isoformat(),
                "timeZone": timezone,
                "items": [{"id": cal_id} for cal_id in calendar_ids],
            }

            result = self.service.freebusy().query(body=body).execute()

            busy_info = {}
            for cal_id, data in result.get("calendars", {}).items():
                busy_info[cal_id] = data.get("busy", [])

            return busy_info
        except HttpError as e:
            self._handle_api_error(e)

    def _parse_event(self, item: dict) -> dict[str, Any]:
        """Parse Google event to standard format."""
        start = item.get("start", {})
        end = item.get("end", {})

        return {
            "id": item["id"],
            "summary": item.get("summary", ""),
            "description": item.get("description", ""),
            "location": item.get("location", ""),
            "start": start.get("dateTime") or start.get("date"),
            "end": end.get("dateTime") or end.get("date"),
            "timezone": start.get("timeZone", ""),
            "status": item.get("status", ""),
            "html_link": item.get("htmlLink", ""),
            "attendees": [
                {
                    "email": a.get("email", ""),
                    "response_status": a.get("responseStatus", ""),
                    "organizer": a.get("organizer", False),
                }
                for a in item.get("attendees", [])
            ],
            "created": item.get("created", ""),
            "updated": item.get("updated", ""),
            "creator": item.get("creator", {}),
            "organizer": item.get("organizer", {}),
        }


async def get_user_info(access_token: str) -> dict[str, Any]:
    """
    Get Google user info from access token.

    Args:
        access_token: Valid access token

    Returns:
        User info with email and id
    """
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    credentials = Credentials(token=access_token)
    service = build("oauth2", "v2", credentials=credentials)

    user_info = service.userinfo().get().execute()

    return {
        "email": user_info.get("email", ""),
        "id": user_info.get("id", ""),
        "name": user_info.get("name", ""),
        "picture": user_info.get("picture", ""),
    }


async def revoke_token(refresh_token: str) -> bool:
    """
    Revoke a Google OAuth token.

    Args:
        refresh_token: Token to revoke

    Returns:
        True if revoked successfully
    """
    import httpx

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://oauth2.googleapis.com/revoke",
                params={"token": refresh_token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            return response.status_code == 200
    except Exception as e:
        logger.error(f"Token revocation failed: {e}")
        return False
