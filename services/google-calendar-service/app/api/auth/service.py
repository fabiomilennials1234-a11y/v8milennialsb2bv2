"""OAuth authentication service."""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.config import Settings
from app.core.exceptions import OAuthStateError, TokenNotFoundError
from app.core.google_client import GoogleOAuthFlow, get_user_info, revoke_token
from app.core.security import OAuthStateManager, TokenEncryptor
from app.db.models import GoogleCalendarTokenCreate
from app.db.repositories import TokenRepository
from app.schemas.auth import (
    AuthorizationUrlResponse,
    CallbackResponse,
    ConnectionStatusResponse,
    RevokeResponse,
)

logger = logging.getLogger(__name__)


class AuthService:
    """Service for Google OAuth operations."""

    def __init__(
        self,
        settings: Settings,
        token_repo: TokenRepository,
        encryptor: TokenEncryptor,
        state_manager: OAuthStateManager,
    ):
        """Initialize auth service."""
        self.settings = settings
        self.token_repo = token_repo
        self.encryptor = encryptor
        self.state_manager = state_manager
        self.oauth_flow = GoogleOAuthFlow(settings)

    async def get_authorization_url(self, user_id: str) -> AuthorizationUrlResponse:
        """
        Generate OAuth authorization URL for a user.

        Args:
            user_id: User ID to associate with OAuth flow

        Returns:
            Authorization URL and state parameter
        """
        # Generate signed state with user_id embedded
        state = self.state_manager.generate_state(user_id)

        # Get Google authorization URL
        authorization_url = self.oauth_flow.get_authorization_url(state)

        return AuthorizationUrlResponse(
            authorization_url=authorization_url,
            state=state,
        )

    async def handle_callback(
        self,
        code: str,
        state: str,
    ) -> CallbackResponse:
        """
        Handle OAuth callback from Google.

        Args:
            code: Authorization code from Google
            state: State parameter for CSRF validation

        Returns:
            Callback result with user info

        Raises:
            OAuthStateError: If state validation fails
        """
        # Validate state and extract user_id
        user_id = self.state_manager.validate_state(state)
        if not user_id:
            raise OAuthStateError("Invalid or expired state parameter")

        # Exchange code for tokens
        tokens = self.oauth_flow.exchange_code(code)

        # Get user info from Google
        user_info = await get_user_info(tokens["access_token"])

        # Check if this Google account is already connected to another user
        existing = await self.token_repo.get_by_google_account(user_info["id"])
        if existing and existing.user_id != user_id:
            raise OAuthStateError(
                f"This Google account is already connected to another user"
            )

        # Encrypt refresh token
        encrypted_token, nonce, key_id = self.encryptor.encrypt(tokens["refresh_token"])

        # Store or update token record
        token_data = GoogleCalendarTokenCreate(
            user_id=user_id,
            google_email=user_info["email"],
            google_account_id=user_info["id"],
            encrypted_refresh_token=encrypted_token,
            encryption_nonce=nonce,
            encryption_key_id=key_id,
            access_token_expires_at=tokens.get("expires_at"),
            scopes_granted=tokens.get("scopes", []),
        )

        # Check if user already has a token (reconnecting)
        existing_user_token = await self.token_repo.get_by_user_id(user_id)
        if existing_user_token:
            # Delete old token and create new one
            await self.token_repo.delete(user_id)

        await self.token_repo.create(token_data)

        logger.info(f"Google Calendar connected for user {user_id}")

        return CallbackResponse(
            success=True,
            user_id=user_id,
            google_email=user_info["email"],
            message="Google Calendar connected successfully",
        )

    async def get_connection_status(self, user_id: str) -> ConnectionStatusResponse:
        """
        Get connection status for a user.

        Args:
            user_id: User ID to check

        Returns:
            Connection status response
        """
        token = await self.token_repo.get_by_user_id(user_id)

        if not token:
            return ConnectionStatusResponse(
                connected=False,
                is_active=False,
            )

        return ConnectionStatusResponse(
            connected=True,
            google_email=token.google_email,
            connected_at=token.connected_at,
            scopes=token.scopes_granted,
            last_sync=token.last_sync_at,
            is_active=token.is_active,
        )

    async def revoke_connection(self, user_id: str) -> RevokeResponse:
        """
        Revoke Google Calendar connection.

        Args:
            user_id: User ID to revoke

        Returns:
            Revoke result
        """
        token = await self.token_repo.get_by_user_id(user_id)

        if not token:
            return RevokeResponse(
                success=False,
                message="No Google Calendar connection found",
            )

        # Decrypt refresh token to revoke it at Google
        try:
            refresh_token = self.encryptor.decrypt(
                token.encrypted_refresh_token,
                token.encryption_nonce,
            )
            await revoke_token(refresh_token)
        except Exception as e:
            logger.warning(f"Failed to revoke token at Google: {e}")
            # Continue anyway - we'll mark it as revoked locally

        # Mark as revoked in database
        await self.token_repo.mark_revoked(user_id)

        logger.info(f"Google Calendar disconnected for user {user_id}")

        return RevokeResponse(
            success=True,
            message="Google Calendar disconnected successfully",
        )
