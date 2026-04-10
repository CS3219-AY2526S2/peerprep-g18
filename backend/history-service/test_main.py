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
    mock_db.collection.return_value.where.return_value.order_by.return_value.stream.return_value = []
    response = client.get("/history/user/test-uid")
    assert response.status_code == 200
    assert response.json() == []
