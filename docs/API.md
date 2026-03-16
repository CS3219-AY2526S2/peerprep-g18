# PeerPrep API Documentation

This document defines the RESTful APIs for the PeerPrep microservices. These APIs are designed to be lightweight and reusable across different systems.

---

## 1. User Service
**Base URL:** `http://user-service:6767`  
**Purpose:** Manages user profiles, role-based access control (RBAC), and integrates with Firebase Auth for identity.

### Endpoints

#### `POST /users`
Create a new user profile and identity.
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
- **Headers:**
  - `X-User-Id`: (Internal) Injected by API Gateway for authorization checks if needed.
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

---

## 2. Question Service
**Base URL:** `http://question-service:6768`  
**Purpose:** Manages a repository of technical questions categorized by topic and difficulty.

### Endpoints

#### `GET /question`
Retrieve a random question ID based on topic and difficulty.
- **Query Parameters:**
  - `topic`: (Required) e.g., "Array", "String"
  - `difficulty`: (Required) e.g., "Easy", "Medium", "Hard"
- **Responses:**
  - `200 OK`: `{"question_id": "string"}`
  - `404 Not Found`: No questions match the criteria.

#### `GET /question/{question_id}`
Retrieve a specific question by its ID.
- **Responses:**
  - `200 OK`: Returns the question details.
  - `404 Not Found`: Question ID does not exist.

#### `POST /question` (Admin Only)
Add a new question to the repository.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"`.
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

#### `PUT /question/{question_id}` (Admin Only)
Update an existing question.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"`.
- **Request Body:** Partial or full question object.
- **Responses:**
  - `200 OK`: Update successful.
  - `403 Forbidden`: Not an admin.
  - `404 Not Found`: Question does not exist.

#### `DELETE /question/{question_id}` (Admin Only)
Remove a question from the repository.
- **Headers:**
  - `X-User-Role`: (Required) Must be `"admin"`.
- **Responses:**
  - `204 No Content`: Deletion successful.
  - `403 Forbidden`: Not an admin.
  - `404 Not Found`: Question does not exist.

---

## 3. Matching Service
**Base URL:** `http://matching-service:6769`  
**Purpose:** A generic matching engine that pairs two entities based on shared requirements. It is stateless regarding sessions; it simply notifies an orchestrator via Redis Pub/Sub when a match is successfully made.

### Endpoints

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
  - `404 Not Found`: Entity was not in the queue.

### Async Notifications (Redis Pub/Sub)
- **Channel:** `match_events`
- **Payload:**
  ```json
  {
    "entity_1_id": "string",
    "entity_2_id": "string",
    "matched_criteria_1": 5,
    "matched_criteria_2": 2
  }
  ```

---

## 4. Editor Service
**Base URL:** `http://editor-service:4001`  
**Purpose:** Specialized service for real-time collaborative text/code editing. Optimized for high-frequency deltas.

### WebSocket (Socket.io)
- **Path:** `/socket.io/editor`
- **Handshake Query:** `?sessionId=xyz`
- **Headers:** `X-User-Id`

#### Events
- `code_change`: `{ delta: any, version: number }` - Client sends a change.
- `code_update`: `{ delta: any, version: number, user_id: string }` - Server broadcasts change.

### REST Endpoints
#### `GET /editor/sessions/{sessionId}`
Retrieve the full current state of the code.
- **Responses:**
  - `200 OK`: `{ "code": "string", "version": 105 }`
  - `404 Not Found`: Session expired.

---

## 5. Chat Service
**Base URL:** `http://chat-service:4002`  
**Purpose:** Specialized service for real-time messaging. Optimized for discrete message objects and history.

### WebSocket (Socket.io)
- **Path:** `/socket.io/chat`
- **Handshake Query:** `?sessionId=xyz`
- **Headers:** `X-User-Id`

#### Events
- `send_message`: `{ text: "string" }` - Client sends a message.
- `receive_message`: `{ id: "uuid", text: "string", user_id: "string", timestamp: "iso_date" }` - Server broadcasts.

### REST Endpoints
#### `GET /chat/sessions/{sessionId}`
Retrieve the message history for the session.
- **Responses:**
  - `200 OK`: `[ { "id": "...", "text": "...", ... }, ... ]`
  - `404 Not Found`: Session expired.
