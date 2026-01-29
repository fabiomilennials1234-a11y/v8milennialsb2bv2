"""API dependencies for authentication and database access."""

import logging
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt

from app.config import Settings, get_settings
from app.core.exceptions import UnauthorizedError
from app.core.security import OAuthStateManager, TokenEncryptor
from app.db import TokenRepository, SyncLogRepository, get_supabase_client, SupabaseClient

logger = logging.getLogger(__name__)


async def get_db() -> SupabaseClient:
    """Get database client dependency."""
    return get_supabase_client()


async def get_token_repository(
    db: SupabaseClient = Depends(get_db),
) -> TokenRepository:
    """Get token repository dependency."""
    return TokenRepository(db)


async def get_sync_log_repository(
    db: SupabaseClient = Depends(get_db),
) -> SyncLogRepository:
    """Get sync log repository dependency."""
    return SyncLogRepository(db)


async def get_encryptor(
    settings: Settings = Depends(get_settings),
) -> TokenEncryptor:
    """Get token encryptor dependency."""
    return TokenEncryptor(settings.google_token_encryption_key)


async def get_state_manager(
    settings: Settings = Depends(get_settings),
) -> OAuthStateManager:
    """Get OAuth state manager dependency."""
    return OAuthStateManager(
        secret_key=settings.google_token_encryption_key,
        ttl_seconds=settings.oauth_state_ttl_seconds,
    )


async def get_current_user(
    authorization: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings),
) -> str:
    """
    Extract and validate user ID from Supabase JWT.

    Args:
        authorization: Bearer token from Authorization header
        settings: Application settings

    Returns:
        User ID (sub claim from JWT)

    Raises:
        HTTPException: If token is missing or invalid
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Extract token from "Bearer <token>"
        scheme, token = authorization.split()
        if scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication scheme",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Decode JWT (Supabase uses HS256 with JWT secret)
        # For development, we decode without full verification
        # For production, you should verify with Supabase's JWKS or JWT secret
        payload = jwt.decode(
            token,
            key="",  # Not used when verify_signature is False
            options={
                "verify_signature": False,
                "verify_aud": False,
                "verify_exp": True,
            },
            algorithms=["HS256"],
        )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing user ID",
            )

        return user_id

    except JWTError as e:
        logger.warning(f"JWT validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization header format",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def verify_internal_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    settings: Settings = Depends(get_settings),
) -> bool:
    """
    Verify internal API key for service-to-service calls.

    Args:
        x_api_key: API key from X-API-Key header
        settings: Application settings

    Returns:
        True if valid

    Raises:
        HTTPException: If key is missing or invalid
    """
    if not x_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key header",
        )

    if x_api_key != settings.internal_api_key:
        logger.warning("Invalid internal API key attempted")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
        )

    return True
