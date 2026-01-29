"""Data access layer (Repository pattern)."""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.db.database import SupabaseClient
from app.db.models import (
    CalendarSyncLog,
    CalendarSyncLogCreate,
    GoogleCalendarToken,
    GoogleCalendarTokenCreate,
    GoogleCalendarTokenUpdate,
)

logger = logging.getLogger(__name__)


class TokenRepository:
    """Repository for Google Calendar token operations."""

    TABLE_NAME = "google_calendar_tokens"

    def __init__(self, db: SupabaseClient):
        """Initialize with database client."""
        self.db = db

    async def get_by_user_id(self, user_id: str) -> Optional[GoogleCalendarToken]:
        """
        Get token record for a user.

        Args:
            user_id: Supabase user ID

        Returns:
            Token record or None if not found
        """
        try:
            result = (
                self.db.table(self.TABLE_NAME)
                .select("*")
                .eq("user_id", user_id)
                .eq("is_active", True)
                .single()
                .execute()
            )

            if result.data:
                return GoogleCalendarToken(**result.data)
            return None
        except Exception as e:
            logger.error(f"Error getting token for user {user_id}: {e}")
            return None

    async def get_by_google_account(
        self, google_account_id: str
    ) -> Optional[GoogleCalendarToken]:
        """
        Get token record by Google account ID.

        Args:
            google_account_id: Google account ID

        Returns:
            Token record or None if not found
        """
        try:
            result = (
                self.db.table(self.TABLE_NAME)
                .select("*")
                .eq("google_account_id", google_account_id)
                .eq("is_active", True)
                .single()
                .execute()
            )

            if result.data:
                return GoogleCalendarToken(**result.data)
            return None
        except Exception:
            return None

    async def create(self, data: GoogleCalendarTokenCreate) -> GoogleCalendarToken:
        """
        Create a new token record.

        Args:
            data: Token data to insert

        Returns:
            Created token record
        """
        insert_data = data.model_dump()
        insert_data["connected_at"] = datetime.now(timezone.utc).isoformat()

        result = (
            self.db.table(self.TABLE_NAME).insert(insert_data).execute()
        )

        return GoogleCalendarToken(**result.data[0])

    async def update(
        self, user_id: str, data: GoogleCalendarTokenUpdate
    ) -> Optional[GoogleCalendarToken]:
        """
        Update a token record.

        Args:
            user_id: User ID
            data: Fields to update

        Returns:
            Updated token record or None
        """
        update_data = data.model_dump(exclude_none=True)
        update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

        result = (
            self.db.table(self.TABLE_NAME)
            .update(update_data)
            .eq("user_id", user_id)
            .execute()
        )

        if result.data:
            return GoogleCalendarToken(**result.data[0])
        return None

    async def update_expiry(
        self, user_id: str, expires_at: datetime
    ) -> bool:
        """
        Update access token expiry time.

        Args:
            user_id: User ID
            expires_at: New expiry time

        Returns:
            True if updated successfully
        """
        try:
            self.db.table(self.TABLE_NAME).update(
                {
                    "access_token_expires_at": expires_at.isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("user_id", user_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error updating expiry for user {user_id}: {e}")
            return False

    async def mark_revoked(self, user_id: str) -> bool:
        """
        Mark a token as revoked.

        Args:
            user_id: User ID

        Returns:
            True if marked successfully
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            self.db.table(self.TABLE_NAME).update(
                {
                    "is_active": False,
                    "revoked_at": now,
                    "updated_at": now,
                }
            ).eq("user_id", user_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error revoking token for user {user_id}: {e}")
            return False

    async def delete(self, user_id: str) -> bool:
        """
        Permanently delete a token record.

        Args:
            user_id: User ID

        Returns:
            True if deleted successfully
        """
        try:
            self.db.table(self.TABLE_NAME).delete().eq("user_id", user_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error deleting token for user {user_id}: {e}")
            return False

    async def set_error(self, user_id: str, error: str) -> bool:
        """
        Set error message on token record.

        Args:
            user_id: User ID
            error: Error message

        Returns:
            True if updated successfully
        """
        try:
            self.db.table(self.TABLE_NAME).update(
                {
                    "last_error": error,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("user_id", user_id).execute()
            return True
        except Exception as e:
            logger.error(f"Error setting error for user {user_id}: {e}")
            return False


class SyncLogRepository:
    """Repository for calendar sync log operations."""

    TABLE_NAME = "google_calendar_sync_logs"

    def __init__(self, db: SupabaseClient):
        """Initialize with database client."""
        self.db = db

    async def create(self, data: CalendarSyncLogCreate) -> CalendarSyncLog:
        """
        Create a sync log entry.

        Args:
            data: Log data to insert

        Returns:
            Created log entry
        """
        insert_data = data.model_dump()

        result = self.db.table(self.TABLE_NAME).insert(insert_data).execute()

        return CalendarSyncLog(**result.data[0])

    async def get_by_user(
        self,
        user_id: str,
        limit: int = 50,
        operation: Optional[str] = None,
    ) -> list[CalendarSyncLog]:
        """
        Get sync logs for a user.

        Args:
            user_id: User ID
            limit: Maximum records to return
            operation: Filter by operation type

        Returns:
            List of sync log entries
        """
        query = (
            self.db.table(self.TABLE_NAME)
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
        )

        if operation:
            query = query.eq("operation", operation)

        result = query.execute()

        return [CalendarSyncLog(**row) for row in result.data]

    async def get_by_reference(
        self,
        reference_type: str,
        reference_id: str,
    ) -> list[CalendarSyncLog]:
        """
        Get sync logs for a local reference (e.g., pipe_confirmacao).

        Args:
            reference_type: Type of local entity
            reference_id: ID of local entity

        Returns:
            List of sync log entries
        """
        result = (
            self.db.table(self.TABLE_NAME)
            .select("*")
            .eq("local_reference_type", reference_type)
            .eq("local_reference_id", reference_id)
            .order("created_at", desc=True)
            .execute()
        )

        return [CalendarSyncLog(**row) for row in result.data]
