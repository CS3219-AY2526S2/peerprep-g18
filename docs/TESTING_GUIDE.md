# PeerPrep Testing Guide

This guide provides instructions on how to add tests to your microservices to ensure the CI pipeline can automatically verify your code.

## 1. Python Services (FastAPI)

For Python services (`api-gateway`, `user-service`, etc.), we use `pytest`.

### Adding a Test
Create a file named `test_main.py` (or anything starting with `test_`) in your service directory.

Example for `user-service/test_main.py`:

```python
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import pytest

# Mocking external dependencies BEFORE importing the app
with patch('firebase_admin.credentials.Certificate'), \
     patch('firebase_admin.initialize_app'), \
     patch('firebase_admin.firestore.client'), \
     patch('redis.Redis'):
    from main import app

client = TestClient(app)

def test_read_main():
    # Example of a simple smoke test
    assert app.title == "PeerPrep User Service (Firebase Auth Version)"

def test_get_user_not_found():
    # You'll need to mock firestore's behavior for more complex tests
    with patch('main.db.collection') as mock_collection:
        mock_collection.return_value.document.return_value.get.return_value.exists = False
        response = client.get("/users/non-existent-id")
        assert response.status_code == 404
        assert response.json() == {"detail": "User profile not found in database"}
```

### Running Locally
```bash
cd backend/user-service
pip install pytest httpx
pytest
```

## 2. Frontend (React + Vite)

For the frontend, you can use `vitest` which integrates well with Vite.

### Setup
1. Install Vitest:
   ```bash
   cd frontend
   npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
   ```
2. Add a test script to `package.json`:
   ```json
   "test": "vitest run"
   ```

### Adding a Test
Create a file named `src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders correctly', () => {
    render(<App />);
    // Add your assertions here
  });
});
```

## 3. Collaboration Service (Node.js)

For Node.js services, you can use `jest` or `mocha`.

### Example with Jest:
1. Install Jest:
   ```bash
   cd backend/collaboration-service
   npm install -D jest supertest
   ```
2. Add a test script to `package.json`:
   ```json
   "test": "jest"
   ```

## CI Pipeline Integration
The CI pipeline (`.github/workflows/ci.yml`) is already configured to:
- Automatically run `pytest` in any Python service folder if it finds files matching `test_*.py`.
- You can easily extend it to run `npm test` for Node.js services by adding the same logic to the `backend-node` or `frontend` jobs.
