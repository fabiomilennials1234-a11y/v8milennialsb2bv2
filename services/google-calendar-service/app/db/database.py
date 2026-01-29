"""Supabase database connection."""

from functools import lru_cache
from typing import Optional

from supabase import Client, create_client

from app.config import get_settings


class SupabaseClient:
    """Wrapper for Supabase client with service role access."""

    def __init__(self, url: str, service_role_key: str):
        """Initialize Supabase client with service role key."""
        self._client: Client = create_client(url, service_role_key)

    @property
    def client(self) -> Client:
        """Get the underlying Supabase client."""
        return self._client

    def table(self, table_name: str):
        """Get a table reference for queries."""
        return self._client.table(table_name)


@lru_cache
def get_supabase_client() -> SupabaseClient:
    """Get cached Supabase client instance."""
    settings = get_settings()
    return SupabaseClient(
        url=settings.supabase_url,
        service_role_key=settings.supabase_service_role_key,
    )
