from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import pytest

# Mocking external dependencies BEFORE importing the app
mock_db = MagicMock()

with patch('firebase_admin.credentials.Certificate'), \
     patch('firebase_admin.initialize_app'), \
     patch('firebase_admin.firestore.client', return_value=mock_db):
    from app.main import app

def test_health_check():
    """Verify health check returns healthy."""
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_get_user_history_empty():
    """Test getting history for a user with no history."""
    client = TestClient(app)
    
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
