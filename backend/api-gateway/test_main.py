from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch, AsyncMock
import pytest
import httpx

# Mocking external dependencies BEFORE importing the app
mock_redis = MagicMock()
mock_http_client = AsyncMock()

with patch('firebase_admin.credentials.Certificate'), \
     patch('firebase_admin.initialize_app'), \
     patch('firebase_admin.auth'), \
     patch('redis.asyncio.Redis', return_value=mock_redis), \
     patch('httpx.AsyncClient', return_value=mock_http_client):
    from main import app

def test_gateway_service_not_found():
    """Test proxying to a non-existent service prefix."""
    client = TestClient(app)
    response = client.get("/invalid-service/path")
    assert response.status_code == 404
    assert response.json() == {"detail": "Service not found"}

@pytest.mark.asyncio
async def test_gateway_proxy_public_route():
    """Test proxying a public route (no auth required)."""
    client = TestClient(app)
    # Mocking the response from the target service
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b'{"success": true}'
    mock_response.headers = {"Content-Type": "application/json"}
    mock_http_client.request.return_value = mock_response

    # /users (POST) is a public route according to main.py
    response = client.post("/users", json={"email": "test@example.com"})
    
    assert response.status_code == 200
    assert response.json() == {"success": True}
    mock_http_client.request.assert_called_once()
