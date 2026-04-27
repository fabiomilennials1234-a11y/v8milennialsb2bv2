"""Pytest fixtures for testing."""

import os
import pytest
from unittest.mock import AsyncMock, MagicMock

# Set test environment variables before importing app
os.environ.update({
    "GOOGLE_CLIENT_ID": "test-client-id",
    "GOOGLE_CLIENT_SECRET": "test-client-secret",
    "GOOGLE_REDIRECT_URI": "http://localhost:8000/api/auth/callback",
    "SUPABASE_URL": "https://test.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
    "GOOGLE_TOKEN_ENCRYPTION_KEY": "dGVzdGtleXRoYXRpc3RoaXJ0eXR3b2J5dGVz",  # 32 bytes base64
    "INTERNAL_API_KEY": "test-internal-api-key",
    "FRONTEND_URL": "http://localhost:5173",
    "APP_ENV": "test",
})

from fastapi.testclient import TestClient

from app.main import app
from app.config import Settings, get_settings
from app.db.database import SupabaseClient, get_supabase_client
from app.db.repositories import TokenRepository, SyncLogRepository


@pytest.fixture
def settings() -> Settings:
    """Get test settings."""
    return get_settings()


@pytest.fixture
def mock_supabase_client():
    """Create a mock Supabase client."""
    mock = MagicMock(spec=SupabaseClient)
    mock.table.return_value = MagicMock()
    return mock


@pytest.fixture
def mock_token_repo(mock_supabase_client):
    """Create a mock token repository."""
    repo = TokenRepository(mock_supabase_client)
    return repo


@pytest.fixture
def mock_sync_log_repo(mock_supabase_client):
    """Create a mock sync log repository."""
    repo = SyncLogRepository(mock_supabase_client)
    return repo


@pytest.fixture
def client(mock_supabase_client):
    """Create test client with mocked dependencies."""
    app.dependency_overrides[get_supabase_client] = lambda: mock_supabase_client

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers():
    """Generate mock authorization headers."""
    # This is a mock JWT - in real tests you'd generate a valid one
    return {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItaWQiLCJhdWQiOiJhdXRoZW50aWNhdGVkIn0.test"
    }


@pytest.fixture
def internal_api_headers():
    """Generate internal API headers."""
    return {
        "X-API-Key": "test-internal-api-key"
    }
