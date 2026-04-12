from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import pytest
import sys

import firebase_admin
from firebase_admin import auth, credentials, firestore

# Mocking external dependencies BEFORE importing the app
# This is necessary because main.py initializes Firebase and Redis at the module level.
mock_db = MagicMock()
mock_auth = MagicMock()
mock_redis = MagicMock()

with patch('firebase_admin.credentials.Certificate'), \
     patch('firebase_admin.initialize_app'), \
     patch('firebase_admin.firestore.client', return_value=mock_db), \
     patch('firebase_admin.auth', mock_auth), \
     patch('redis.Redis', return_value=mock_redis):
    # We must ensure the environment variable for SMTP is set or handled if needed
    import main
    from main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_read_main_title():
    """Verify the app title is correct."""
    assert app.title == "PeerPrep User Service (Firebase Auth Version)"

def test_get_user_not_found(client):
    """Test retrieving a non-existent user."""
    mock_db.collection.return_value.document.return_value.get.return_value.exists = False
    response = client.get("/users/non-existent-id")
    assert response.status_code == 404
    assert response.json() == {"detail": "User profile not found in database"}

def test_get_user_success(client):
    """Test retrieving an existing user."""
    mock_user_data = {
        "user_id": "test-uid",
        "username": "testuser",
        "email": "test@example.com",
        "avatar_id": 1,
        "role": "User"
    }
    mock_doc = MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = mock_user_data
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    
    response = client.get("/users/test-uid")
    assert response.status_code == 200
    assert response.json() == mock_user_data

def test_lookup_username_not_found(client):
    """Test looking up a username that doesn't exist."""
    # Updated mock to use .where()
    mock_db.collection.return_value.where.return_value.limit.return_value.get.return_value = []
    response = client.get("/users/lookup/nonexistent")
    assert response.status_code == 404
    assert response.json() == {"detail": "Username not found"}

def test_lookup_username_success(client):
    """Test looking up a username successfully."""
    # Updated mock to use .where()
    mock_user = MagicMock()
    mock_user.to_dict.return_value = {"username": "TestUser", "email": "test@example.com"}
    mock_db.collection.return_value.where.return_value.limit.return_value.get.return_value = [mock_user]
    
    response = client.get("/users/lookup/testuser")
    assert response.status_code == 200
    assert response.json() == {"email": "test@example.com"}
