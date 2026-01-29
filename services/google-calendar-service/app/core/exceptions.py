"""Custom exceptions for the calendar service."""

from typing import Any, Optional


class CalendarServiceError(Exception):
    """Base exception for calendar service errors."""

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        details: Optional[dict[str, Any]] = None,
    ):
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class UnauthorizedError(CalendarServiceError):
    """Raised when authentication fails."""

    def __init__(self, message: str = "Unauthorized", details: Optional[dict] = None):
        super().__init__(message, status_code=401, details=details)


class TokenNotFoundError(CalendarServiceError):
    """Raised when Google tokens are not found for a user."""

    def __init__(self, user_id: str):
        super().__init__(
            message="Google Calendar not connected",
            status_code=404,
            details={"user_id": user_id},
        )


class TokenExpiredError(CalendarServiceError):
    """Raised when refresh token is expired or revoked."""

    def __init__(self, user_id: str, reason: str = "Token expired or revoked"):
        super().__init__(
            message=reason,
            status_code=401,
            details={"user_id": user_id, "action_required": "reconnect"},
        )


class TokenEncryptionError(CalendarServiceError):
    """Raised when token encryption/decryption fails."""

    def __init__(self, operation: str, reason: str):
        super().__init__(
            message=f"Token {operation} failed: {reason}",
            status_code=500,
            details={"operation": operation},
        )


class GoogleAPIError(CalendarServiceError):
    """Raised when Google API returns an error."""

    def __init__(
        self,
        message: str,
        google_error_code: Optional[int] = None,
        google_error_reason: Optional[str] = None,
    ):
        super().__init__(
            message=message,
            status_code=502,  # Bad Gateway - upstream service error
            details={
                "google_error_code": google_error_code,
                "google_error_reason": google_error_reason,
            },
        )


class OAuthStateError(CalendarServiceError):
    """Raised when OAuth state validation fails."""

    def __init__(self, reason: str = "Invalid or expired OAuth state"):
        super().__init__(
            message=reason,
            status_code=400,
            details={"action_required": "restart_oauth"},
        )


class CalendarNotConnectedError(CalendarServiceError):
    """Raised when trying to access calendar without connection."""

    def __init__(self, user_id: str):
        super().__init__(
            message="Google Calendar not connected. Please connect your calendar first.",
            status_code=400,
            details={"user_id": user_id, "action_required": "connect_calendar"},
        )
