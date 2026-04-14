from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import pytest

# Mocking external dependencies BEFORE importing the app
mock_db = MagicMock()

with patch('firebase_admin.credentials.Certificate'), \
     patch('firebase_admin.initialize_app'), \
     patch('firebase_admin.firestore.client', return_value=mock_db):
    from app.main import app
    import app.database as db_module
    # Inject the mock directly so lazy get_db() returns it without network calls
    db_module._db = mock_db

def test_health_check():
    """Verify health check returns healthy."""
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

def test_get_topics_empty():
    """Test getting topics when database is empty."""
    client = TestClient(app)
    mock_db.collection.return_value.select.return_value.stream.return_value = []
    response = client.get("/question/topics")
    assert response.status_code == 200
    assert response.json() == []

def test_get_topics_success():
    """Test getting topics successfully."""
    client = TestClient(app)
    mock_doc1 = MagicMock()
    mock_doc1.to_dict.return_value = {"topic": "Strings"}
    mock_doc2 = MagicMock()
    mock_doc2.to_dict.return_value = {"topic": "Arrays"}
    
    mock_db.collection.return_value.select.return_value.stream.return_value = [mock_doc1, mock_doc2]
    
    response = client.get("/question/topics")
    assert response.status_code == 200
    assert response.json() == ["Arrays", "Strings"] # Sorted alphabetically
