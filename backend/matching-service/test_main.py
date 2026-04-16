from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch, AsyncMock
import pytest

# Mocking external dependencies BEFORE importing the app
with patch('redis.asyncio.Redis'):
    from app.main import app

def test_health_check_uninitialized():
    """Verify health check returns unhealthy if Redis is not connected."""
    # We use a fresh TestClient without context manager to avoid startup_event for this test
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "unhealthy"

def test_health_check_success():
    """Verify health check returns healthy if Redis is connected and pings."""
    with patch('app.database.redis_match') as mock_redis:
        mock_redis.ping = AsyncMock(return_value=True)
        
        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
        assert response.json()["match_db"] == True
