"""OAuth authentication API."""

from app.api.auth.router import router
from app.api.auth.service import AuthService

__all__ = ["router", "AuthService"]
