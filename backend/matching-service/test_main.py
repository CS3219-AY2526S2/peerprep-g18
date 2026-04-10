from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import pytest

# Mocking external dependencies BEFORE importing the app
with patch('redis.asyncio.Redis'):
    from app.main import app

client = TestClient(app)

def test_health_check_uninitialized():
    """Verify health check returns unhealthy if Redis is not connected."""
    response = client.get("/health")
    # In main.py, ping() will fail if database.redis_match is None
    assert response.status_code == 200
    assert response.json()["status"] == "unhealthy"

def test_health_check_success():
    """Verify health check returns healthy if Redis is connected and pings."""
    with patch('app.database.redis_match') as mock_redis:
        mock_redis.ping = MagicMock()
        mock_redis.ping.return_value = "PONG"
        
        # We need to mock it as an async function if it's used with await
        # But wait, in main.py: ping_match = await database.redis_match.ping()
        # So we need AsyncMock
        from unittest.mock import AsyncMock
        mock_redis.ping = AsyncMock(return_value=True)
        
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
        assert response.json()["match_db"] == True
