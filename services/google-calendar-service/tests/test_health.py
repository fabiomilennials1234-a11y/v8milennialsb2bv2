"""Tests for health check endpoint."""

import pytest


def test_health_check(client):
    """Test health check returns healthy status."""
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "google-calendar-service"
