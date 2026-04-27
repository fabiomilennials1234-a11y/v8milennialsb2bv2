"""Authentication-related schemas."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AuthorizationUrlResponse(BaseModel):
    """Response containing OAuth authorization URL."""

    authorization_url: str = Field(..., description="Google OAuth consent URL")
    state: str = Field(..., description="CSRF state parameter")


class ConnectionStatusResponse(BaseModel):
    """Response with Google Calendar connection status."""

    connected: bool = Field(..., description="Whether calendar is connected")
    google_email: Optional[str] = Field(None, description="Connected Google email")
    connected_at: Optional[datetime] = Field(None, description="When connected")
    scopes: list[str] = Field(default_factory=list, description="Granted scopes")
    last_sync: Optional[datetime] = Field(None, description="Last sync timestamp")
    is_active: bool = Field(True, description="Whether connection is active")


class RevokeResponse(BaseModel):
    """Response for revoke operation."""

    success: bool
    message: str


class CallbackResponse(BaseModel):
    """Internal response after OAuth callback processing."""

    success: bool
    user_id: str
    google_email: str
    message: str
