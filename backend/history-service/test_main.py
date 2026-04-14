from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch, AsyncMock
import pytest
import httpx

# Mocking external dependencies BEFORE importing the app
mock_db = MagicMock()
mock_http_client = AsyncMock()
mock_http_client.is_closed = False

with patch('firebase_admin.credentials.Certificate'), \
     patch('firebase_admin.initialize_app'), \
     patch('firebase_admin.firestore.client', return_value=mock_db), \
     patch('httpx.AsyncClient', return_value=mock_http_client):
    # Import app from the main module and rename it to avoid collision with 'app' package
    from app.main import app as fastapi_app
    import app.database as db_module
    db_module._db = mock_db

# Inject mock client for history-service lazy initialization
# This needs to match the import in app/api/routes.py
import app.api.routes
app.api.routes.http_client = mock_http_client

def test_health_check():
    """Verify health check returns healthy."""
    client = TestClient(fastapi_app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_get_user_history_empty():
    """Test getting history for a user with no history."""
    client = TestClient(fastapi_app)
    
    # Mock empty stream
    mock_db.collection.return_value.where.return_value.select.return_value.order_by.return_value.limit.return_value.offset.return_value.stream.return_value = []
    
    # Mock count result
    mock_db.collection.return_value.where.return_value.count.return_value.get.return_value = [[MagicMock(value=0)]]
    
    # Correct endpoint is /history/user and requires X-User-Id header
    response = client.get("/history/user", headers={"X-User-Id": "test-uid"})
    
    assert response.status_code == 200
    expected_response = {
        "attempts": [],
        "total_pages": 0,
        "current_page": 1,
        "total_items": 0
    }
    assert response.json() == expected_response

@pytest.mark.asyncio
async def test_save_history():
    """Test saving history triggers external question fetch."""
    client = TestClient(fastapi_app)
    
    payload = {
        "sessionId": "test-session",
        "user1_id": "user-1",
        "user2_id": "user-2",
        "questionId": 1,
        "title": "Old Title",
        "topic": "Strings",
        "difficulty": "Easy",
        "finalCode": "print('hello')",
        "submittedBy": "user-1",
        "startedAt": "2026-04-12T20:00:00Z",
        "endedAt": "2026-04-12T20:10:00Z"
    }

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"title": "New Title", "topic": "Strings", "difficulty": "Easy"}
    mock_http_client.get.return_value = mock_response

    response = client.post("/history/", json=payload)
    
    assert response.status_code == 201
    assert response.json() == {"detail": "saved"}
    mock_http_client.get.assert_called_once()
