"""OAuth authentication routes."""

import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse

from app.api.auth.service import AuthService
from app.api.deps import (
    get_current_user,
    get_encryptor,
    get_state_manager,
    get_token_repository,
)
from app.config import Settings, get_settings
from app.core.exceptions import OAuthStateError
from app.core.security import OAuthStateManager, TokenEncryptor
from app.db.repositories import TokenRepository
from app.schemas.auth import (
    AuthorizationUrlResponse,
    ConnectionStatusResponse,
    RevokeResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def get_auth_service(
    settings: Settings = Depends(get_settings),
    token_repo: TokenRepository = Depends(get_token_repository),
    encryptor: TokenEncryptor = Depends(get_encryptor),
    state_manager: OAuthStateManager = Depends(get_state_manager),
) -> AuthService:
    """Build AuthService with dependencies."""
    return AuthService(
        settings=settings,
        token_repo=token_repo,
        encryptor=encryptor,
        state_manager=state_manager,
    )


@router.get("/google", response_model=AuthorizationUrlResponse)
async def initiate_oauth(
    user_id: str = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    """
    Initiate Google OAuth flow.

    Returns the Google authorization URL for the user to visit.
    """
    return await service.get_authorization_url(user_id)


@router.get("/callback")
async def oauth_callback(
    code: str = Query(..., description="Authorization code from Google"),
    state: str = Query(..., description="State parameter for CSRF protection"),
    service: AuthService = Depends(get_auth_service),
    settings: Settings = Depends(get_settings),
):
    """
    Handle OAuth callback from Google.

    Exchanges the authorization code for tokens and stores them.
    Redirects to frontend with success/error status.
    """
    try:
        result = await service.handle_callback(code, state)

        # Redirect to frontend with success
        redirect_url = f"{settings.frontend_url}/settings/integrations"
        params = {"google": "connected", "email": result.google_email}
        return RedirectResponse(url=f"{redirect_url}?{urlencode(params)}")

    except OAuthStateError as e:
        logger.warning(f"OAuth state error: {e.message}")
        redirect_url = f"{settings.frontend_url}/settings/integrations"
        params = {"google": "error", "reason": e.message}
        return RedirectResponse(url=f"{redirect_url}?{urlencode(params)}")

    except Exception as e:
        logger.error(f"OAuth callback error: {e}")
        redirect_url = f"{settings.frontend_url}/settings/integrations"
        params = {"google": "error", "reason": "Connection failed"}
        return RedirectResponse(url=f"{redirect_url}?{urlencode(params)}")


@router.get("/status", response_model=ConnectionStatusResponse)
async def connection_status(
    user_id: str = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    """
    Check Google Calendar connection status.

    Returns whether the user has connected their calendar and related metadata.
    """
    return await service.get_connection_status(user_id)


@router.post("/revoke", response_model=RevokeResponse)
async def revoke_connection(
    user_id: str = Depends(get_current_user),
    service: AuthService = Depends(get_auth_service),
):
    """
    Revoke Google Calendar connection.

    Disconnects the user's Google Calendar and revokes the OAuth token.
    """
    return await service.revoke_connection(user_id)
