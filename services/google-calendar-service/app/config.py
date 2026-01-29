"""Application configuration from environment variables."""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    app_name: str = "Google Calendar Service"
    app_env: str = "development"
    debug: bool = False
    log_level: str = "INFO"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Google OAuth
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str

    # Google API Scopes (principle of least privilege)
    google_scopes: list[str] = [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "openid",
    ]

    # Supabase
    supabase_url: str
    supabase_service_role_key: str

    # Security
    google_token_encryption_key: str  # 32-byte base64-encoded key for AES-256
    internal_api_key: str  # API key for internal/AI agent access
    jwt_secret: Optional[str] = None  # Optional: for verifying Supabase JWTs locally

    # Frontend
    frontend_url: str = "http://localhost:5173"

    # OAuth State
    oauth_state_ttl_seconds: int = 600  # 10 minutes

    @property
    def is_production(self) -> bool:
        """Check if running in production."""
        return self.app_env.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
