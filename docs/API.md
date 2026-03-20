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

## 4. Collaboration Service
**Base URL:** `http://collab-service:4000`
**Purpose:** Real-time collaborative code editing (Yjs CRDT) and chat over Socket.IO. Ticket-based authentication — each connection requires a one-time ticket obtained from the API Gateway.

### API Gateway Endpoints (Collab-related)

These endpoints live in the API Gateway but serve the collaboration flow.

#### `GET /matching/events`
Subscribe to Server-Sent Events for match notifications.
- **Headers:**
  - `Authorization`: (Required) `Bearer <firebase_id_token>`
- **Response:** `text/event-stream`
  ```
  data: {"event": "connected"}
  data: {"event": "match_found", "sessionId": "uuid", "questionId": "1"}
  data: {"event": "timeout"}
  ```

#### `GET /collab/session/{sessionId}`
Retrieve session metadata. Only accessible by session members.
- **Headers:**
  - `Authorization`: (Required) `Bearer <firebase_id_token>`
- **Responses:**
  - `200 OK`:
    ```json
    {
      "sessionId": "uuid",
      "questionId": "1",
      "topic": "Strings",
      "difficulty": "Easy",
      "user1_id": "uid_A",
      "user2_id": "uid_B",
      "startedAt": 1774017000.0
    }
    ```
  - `403 Forbidden`: Not a member of this session.
  - `404 Not Found`: Session does not exist or has expired.

#### `POST /collab/join`
Issue a one-time WebSocket ticket. Tickets expire after 60 seconds and are single-use. Get one ticket per namespace connection (editor + chat = 2 tickets).
- **Headers:**
  - `Authorization`: (Required) `Bearer <firebase_id_token>`
- **Request Body:**
  ```json
  {
    "sessionId": "uuid"
  }
  ```
- **Responses:**
  - `200 OK`: `{"ticket": "one-time-UUID"}`
  - `400 Bad Request`: Missing sessionId.
  - `403 Forbidden`: Not a member of this session.
  - `404 Not Found`: Session does not exist.

### WebSocket — Editor Namespace (`/editor`)

Connect via Socket.IO to `http://localhost/editor` with `path: '/socket.io'` and `query: { ticket }`.

Ticket is validated by the collab service on connection. On success, `userId` and `sessionId` are attached to the socket.

#### Client-to-Server Events
- `yjs-update`: `Uint8Array` — Send local Yjs document changes to the server. The server persists the update and broadcasts to the partner.

#### Server-to-Client Events
- `yjs-sync`: `Uint8Array` — Full document state sent on connect (or reconnect).
- `yjs-update`: `Uint8Array` — Incremental update from the partner.
- `user-joined`: `{ userId: string }` — Partner has connected.
- `user-left`: `{ userId: string, message: string }` — Partner has disconnected. Message: `"Your partner has left. Editing is disabled."`

#### Frontend Integration
```javascript
import * as Y from 'yjs'
import { io } from 'socket.io-client'

const ydoc = new Y.Doc()
const ytext = ydoc.getText('code')

const editorSocket = io('http://localhost/editor', {
  path: '/socket.io',
  query: { ticket: '<ticket>' },
  transports: ['websocket'],
})

editorSocket.on('yjs-sync', (update) => Y.applyUpdate(ydoc, new Uint8Array(update)))
editorSocket.on('yjs-update', (update) => Y.applyUpdate(ydoc, new Uint8Array(update), 'remote'))
ydoc.on('update', (update, origin) => {
  if (origin !== 'remote') editorSocket.emit('yjs-update', update)
})
```

The shared text type is `ydoc.getText('code')`. Bind this to your code editor (e.g., `y-monaco` for Monaco, `y-codemirror.next` for CodeMirror).

### WebSocket — Chat Namespace (`/chat`)

Connect via Socket.IO to `http://localhost/chat` with `path: '/socket.io'` and `query: { ticket }`.

#### Client-to-Server Events
- `send-message`: `{ text: string }` — Send a chat message. HTML tags (`<>`) are stripped server-side.

#### Server-to-Client Events
- `chat-history`: `[{ sender, text, time }]` — Last 50 messages, sent on connect.
- `receive-message`: `{ sender: string, text: string, time: string }` — New message from either user. Time format: `"HH:MM"`.

#### Frontend Integration
```javascript
const chatSocket = io('http://localhost/chat', {
  path: '/socket.io',
  query: { ticket: '<ticket>' },
  transports: ['websocket'],
})

chatSocket.on('chat-history', (messages) => { /* render history */ })
chatSocket.on('receive-message', ({ sender, text, time }) => { /* append */ })
chatSocket.emit('send-message', { text: 'Hello!' })
```

### Reconnect Flow

On disconnect, get a new ticket before reconnecting:
```javascript
editorSocket.on('disconnect', async () => {
  const res = await fetch('/api/collab/join', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId })
  })
  const { ticket } = await res.json()
  editorSocket.io.opts.query.ticket = ticket
  editorSocket.connect()
})
```

### Session Lifecycle
1. Match found → `sessionId` created in Redis (2h TTL)
2. Both users connect (editor + chat)
3. Real-time collaboration (Yjs + chat)
4. Both users disconnect → 30-second grace period
5. If no reconnect → session saved to Firestore, Redis keys cleaned up

---

## 5. History Service
**Base URL:** `http://history-service:6770`
**Purpose:** Persists completed session records to Firestore. Called internally by the API Gateway after a session ends (not exposed to frontend directly).

### Endpoints

#### `POST /history`
Save a completed session record to Firestore.
- **Request Body:**
  ```json
  {
    "sessionId": "uuid",
    "user1_id": "uid_A",
    "user2_id": "uid_B",
    "questionId": "1",
    "topic": "Strings",
    "difficulty": "Easy",
    "finalCode": "function hello() { return 'world' }",
    "startedAt": 1774017000.0,
    "endedAt": 1774020600.0
  }
  ```
- **Responses:**
  - `201 Created`: `{"detail": "saved"}`

#### `GET /history/{user_id}`
Retrieve all session records for a given user.
- **Responses:**
  - `200 OK`: Returns an array of session records where the user was either `user1_id` or `user2_id`.