"""Database models (Pydantic representations of DB tables)."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class GoogleCalendarToken(BaseModel):
    """Model for google_calendar_tokens table."""

    id: Optional[str] = None
    user_id: str
    organization_id: Optional[str] = None
    google_email: str
    google_account_id: str
    encrypted_refresh_token: str
    encryption_nonce: str
    encryption_key_id: str
    access_token_expires_at: Optional[datetime] = None
    scopes_granted: list[str]
    is_active: bool = True
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None
    connected_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class GoogleCalendarTokenCreate(BaseModel):
    """Data for creating a new token record."""

    user_id: str
    organization_id: Optional[str] = None
    google_email: str
    google_account_id: str
    encrypted_refresh_token: str
    encryption_nonce: str
    encryption_key_id: str
    access_token_expires_at: Optional[datetime] = None
    scopes_granted: list[str]


class GoogleCalendarTokenUpdate(BaseModel):
    """Data for updating a token record."""

    access_token_expires_at: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None
    is_active: Optional[bool] = None


class CalendarSyncLog(BaseModel):
    """Model for google_calendar_sync_logs table."""

    id: Optional[str] = None
    user_id: str
    operation: str  # 'create_event', 'update_event', 'delete_event', 'sync'
    google_event_id: Optional[str] = None
    local_reference_id: Optional[str] = None
    local_reference_type: Optional[str] = None
    status: str  # 'success', 'failed', 'pending'
    error_message: Optional[str] = None
    request_payload: Optional[dict[str, Any]] = None
    response_payload: Optional[dict[str, Any]] = None
    initiated_by: str  # 'user', 'ai_agent', 'system'
    agent_id: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CalendarSyncLogCreate(BaseModel):
    """Data for creating a sync log entry."""

    user_id: str
    operation: str
    google_event_id: Optional[str] = None
    local_reference_id: Optional[str] = None
    local_reference_type: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    request_payload: Optional[dict[str, Any]] = None
    response_payload: Optional[dict[str, Any]] = None
    initiated_by: str
    agent_id: Optional[str] = None
