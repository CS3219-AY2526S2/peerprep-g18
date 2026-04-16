from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import os
import pytest

# Set dummy API key before importing app
os.environ["GEMINI_API_KEY"] = "dummy-key"

with patch('google.genai.Client') as mock_genai_client:
    import main
    from main import app

def test_generate_response_no_key():
    """Test when API key is missing."""
    client = TestClient(app)
    with patch('main.api_key', None):
        response = client.post("/generate", json={"prompt": "hello"})
        assert response.status_code == 500
        assert "Gemini API Key not configured" in response.json()["detail"]

def test_generate_response_success():
    """Test successful response generation."""
    client = TestClient(app)
    mock_response = MagicMock()
    mock_response.text = "Hello! I am Gemini."
    
    with patch('main.client') as mock_client:
        mock_client.models.generate_content.return_value = mock_response
        
        response = client.post("/generate", json={"prompt": "hi", "context": "user is testing"})
        assert response.status_code == 200
        assert response.json() == {"response": "Hello! I am Gemini."}
        
        # Verify call arguments
        mock_client.models.generate_content.assert_called_once()
        args, kwargs = mock_client.models.generate_content.call_args
        assert kwargs["model"] == "gemini-3.1-flash-lite-preview"
        assert "user is testing" in kwargs["contents"]
        assert "hi" in kwargs["contents"]
