# PeerPrep API Documentation

This document defines the RESTful APIs for the PeerPrep microservices. These APIs are designed to be lightweight and reusable across different systems.

---

## 1. User Service
**Base URL:** `http://user-service:6767`  
**Purpose:** Manages user profiles, role-based access control (RBAC), and integrates with Firebase Auth for identity.

### Endpoints

#### `POST /users`
Create a new user profile and identity. Sends a verification email upon creation.
- **Request Body:**
  ```json
  {
    "username": "string",
    "email": "user@example.com",
    "password": "securepassword123",
    "confirm_password": "securepassword123",
    "avatar_id": 1,
    "role": "User"
  }
  ```
- **Responses:**
  - `200 OK`: User created successfully. Returns the user profile.
  - `400 Bad Request`: Username/Email already exists or passwords don't match.
  - `500 Internal Server Error`: Firebase Auth or Firestore failure.

#### `GET /users/{user_id}`
Retrieve a user's profile by their unique ID.
- **Responses:**
  - `200 OK`: Returns the user profile object.
  - `404 Not Found`: User profile does not exist.

#### `GET /users/lookup/{username}`
Find a user's email by their username (useful for multi-identifier login).
- **Responses:**
  - `200 OK`: `{"email": "user@example.com"}`
  - `404 Not Found`: Username does not exist.

#### `PATCH /users/{user_id}`
Update user profile fields or password.
- **Headers:**
  - `X-User-Id`: (Required) Must match `{user_id}` for authorization.
- **Request Body (Optional fields):**
  ```json
  {
    "username": "new_username",
    "password": "new_password",
    "confirm_password": "new_password",
    "avatar_id": 2
  }
  ```
- **Responses:**
  - `200 OK`: Update successful.
  - `403 Forbidden`: `X-User-Id` does not match `{user_id}`.
  - `400 Bad Request`: Username already taken or validation error.

#### `DELETE /users/{user_id}`
Permanently delete a user's identity and profile.
- **Headers:**
  - `X-User-Id`: (Required) Must match `{user_id}` for authorization.
- **Responses:**
  - `200 OK`: Deletion successful.
  - `403 Forbidden`: Unauthorized.
  - `404 Not Found`: User does not exist.

### Admin Endpoints

#### `GET /admin/users`
Retrieve all user profiles.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"` or `"root"`.
- **Responses:**
  - `200 OK`: Returns a list of user profiles.
  - `403 Forbidden`: Not an admin.

#### `POST /admin/promote/{target_user_id}`
Promote a user to Admin role.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"` or `"root"`.
- **Responses:**
  - `200 OK`: Promotion successful.
  - `403 Forbidden`: Not an admin.
  - `404 Not Found`: User does not exist.

#### `DELETE /admin/users/{user_id}`
Delete any user account (except Root).
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"` or `"root"`.
- **Responses:**
  - `200 OK`: Deletion successful.
  - `403 Forbidden`: Not an admin or trying to delete Root.
  - `404 Not Found`: User does not exist.

---

## 2. Question Service
**Base URL:** `http://question-service:6768/question`  
**Purpose:** Manages a repository of technical questions categorized by topic and difficulty.

### Endpoints

#### `GET /`
Retrieve a random question ID based on topic and difficulty.
- **Query Parameters:**
  - `topic`: (Required) e.g., "Array", "String"
  - `difficulty`: (Required) e.g., "Easy", "Medium", "Hard"
- **Responses:**
  - `200 OK`: `{"question_id": "string"}`
  - `404 Not Found`: No questions match the criteria.

#### `GET /{question_id}`
Retrieve a specific question by its ID.
- **Responses:**
  - `200 OK`: Returns the question details.
  - `404 Not Found`: Question ID does not exist.

#### `POST /` (Admin Only)
Add a new question to the repository.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"` or `"root"`.
- **Request Body:**
  ```json
  {
    "title": "Two Sum",
    "topic": "Array",
    "difficulty": "Easy",
    "description": "Find two numbers that add up to a target...",
    "hint": "Try using a hash map.",
    "code_template": "def two_sum(nums, target):"
  }
  ```
- **Responses:**
  - `201 Created`: Question added successfully.
  - `403 Forbidden`: Not an admin.

#### `PUT /{question_id}` (Admin Only)
Update an existing question.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"` or `"root"`.
- **Request Body (Partial update supported):**
  ```json
  {
    "title": "New Title",
    "topic": "New Topic"
  }
  ```
- **Responses:**
  - `200 OK`: Update successful.
  - `403 Forbidden`: Not an admin.
  - `404 Not Found`: Question does not exist.

#### `DELETE /{question_id}` (Admin Only)
Remove a question from the repository.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"` or `"root"`.
- **Responses:**
  - `204 No Content`: Deletion successful.
  - `403 Forbidden`: Not an admin.
  - `404 Not Found`: Question does not exist.

---

## 3. Matching Service
**Base URL:** `http://matching-service:6769`  
**Status:** Currently simulated in the frontend. Planned as a standalone service.
**Purpose:** A generic matching engine that pairs two entities based on shared requirements. It is stateless regarding sessions; it simply notifies an orchestrator via Redis Pub/Sub when a match is successfully made.

#### `POST /find-pair`
Enqueue an entity to be matched. The engine looks for another entity where at least one value in `criteria_1_options` and one value in `criteria_2_options` overlap.
- **Request Body:**
  ```json
  {
    "entity_id": "string",
    "criteria_1_options": [1, 5, 10],
    "criteria_2_options": [2, 3]
  }
  ```
- **Responses:**
  - `202 Accepted`: Entity successfully enqueued.
  - `400 Bad Request`: Entity already in queue or invalid input.

#### `DELETE /cancel-pair/{entity_id}`
Remove an entity from the matching queue.
- **Responses:**
  - `200 OK`: Successfully removed from queue.

---

## 3. Collaboration Service
**Base URL:** `http://collab-service:4000`  
**Purpose:** Specialized service for real-time collaborative text/code editing and chat.

### WebSocket (Socket.io)

#### Client-to-Server Events
- `join-session`: `{ sessionId: string, username: string }` - Join an isolated session room.
- `code-change`: `{ sessionId: string, code: string }` - Broadcast code changes to the partner.
- `send-message`: `{ sessionId: string, message: { sender: string, text: string } }` - Send a chat message.

#### Server-to-Client Events
- `code-update`: `code: string` - Received code from the partner.
- `receive-message`: `{ sender: string, text: string, time: string }` - Received a message from the partner.