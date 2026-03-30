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
**Purpose:** Pairs two users based on overlapping topic and difficulty preferences. Publishes match events via Redis Pub/Sub. Also owns the SSE stream and session creation logic.

#### `POST /matching/find-pair`
Enqueue a user to be matched.
- **Headers:**
  - `X-User-Id`: (Injected by API Gateway)
- **Request Body:**
  ```json
  {
    "topic_options": ["Array", "String"],
    "difficulty_options": ["Easy", "Medium"]
  }
  ```
- **Responses:**
  - `202 Accepted`: User successfully enqueued or match found immediately.
  - `400 Bad Request`: User already in queue.

#### `DELETE /matching/cancel-pair`
Remove a user from the matching queue.
- **Headers:**
  - `X-User-Id`: (Injected by API Gateway)
- **Responses:**
  - `200 OK`: Successfully removed from queue.
  - `404 Not Found`: User was not in the queue.

#### `GET /matching/events`
Subscribe to Server-Sent Events for match notifications. The API Gateway proxies this as a streaming response.
- **Headers:**
  - `Authorization`: (Required) `Bearer <firebase_id_token>`
- **Response:** `text/event-stream`
  ```
  event: connected
  data: {}

  event: match_found
  data: {"sessionId": "uuid", "questionId": "1"}

  event: timeout
  data: {}
  ```
- **Notes:** When a match is found, the matching service runs a distributed leader election (Redis SETNX) to create the session atomically. The session metadata and active-session pointers are written to `redis-sessions`.

---

## 4. Collaboration Service
**Base URL:** `http://collab-service:4000`
**Purpose:** Real-time collaborative code editing (Yjs CRDT) and chat over Socket.IO. Also serves REST endpoints for session management. Ticket-based authentication — each WebSocket connection requires a one-time ticket obtained via `POST /collab/join`.

### REST Endpoints

These REST endpoints are served by the collaboration service and proxied through the API Gateway (auth injected as `X-User-Id`).

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

#### `GET /collab/active-session`
Get the caller's currently active session ID, if any.
- **Headers:**
  - `Authorization`: (Required) `Bearer <firebase_id_token>`
- **Responses:**
  - `200 OK`: `{"sessionId": "uuid"}` or `{"sessionId": null}`

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

#### `POST /collab/end-session/{sessionId}`
Clear the caller's active-session pointer in Redis. Call this after the user navigates away from the collaboration page.
- **Headers:**
  - `Authorization`: (Required) `Bearer <firebase_id_token>`
- **Responses:**
  - `200 OK`: `{"detail": "Active session cleared"}`
  - `403 Forbidden`: Not a member of this session.
  - `404 Not Found`: Session does not exist.

### WebSocket — Editor Namespace (`/editor`)

Connect via Socket.IO to `http://localhost/editor` with `path: '/socket.io'` and `query: { ticket }`.

Ticket is validated by the collab service on connection. On success, `userId` and `sessionId` are attached to the socket.

#### Client-to-Server Events
- `yjs-update`: `Uint8Array` — Send local Yjs document changes to the server. The server persists the update and broadcasts to the partner.
- `end-session`: (no payload) — User explicitly ends the session. Triggers a code snapshot, saves the user's history, and emits `partner-ended` to the other user.

#### Server-to-Client Events
- `yjs-sync`: `Uint8Array` — Full document state sent on connect (or reconnect).
- `yjs-update`: `Uint8Array` — Incremental update from the partner.
- `user-joined`: `{ userId: string }` — Partner has connected. Also sent to a newly connecting user for each user already in the session.
- `user-left`: `{ userId: string, message: string }` — Partner has disconnected. A 30-second reconnect window starts; if the partner does not reconnect, `partner-ended` is emitted.
- `partner-ended`: `{ userId: string }` — Partner has permanently left (either clicked "End Session" or failed to reconnect within 30 seconds). The remaining user is prompted to continue coding solo or end their session.

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

// End session explicitly
editorSocket.emit('end-session')

// Handle partner leaving
editorSocket.on('partner-ended', () => {
  // Show modal: "Your partner ended the session. Continue or End?"
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
4. A user leaves (explicit "End Session" or disconnect):
   - **Explicit end:** Code is snapshotted immediately and saved as that user's history. `partner-ended` emitted to the other user.
   - **Disconnect:** 30-second reconnect window. If the user reconnects, session continues normally. If not, treated the same as explicit end (snapshot + save + `partner-ended`).
5. Remaining user sees a prompt: "Continue coding" or "End session"
   - **Continue:** User keeps editing solo. Editor + chat remain functional.
   - **End:** User's code is snapshotted and saved as their own history entry.
6. When all users have disconnected → 30-second cleanup → Redis keys deleted

Each user gets their own history entry with the code snapshot from when **they** left, stored as `{sessionId}_{userId}` in Firestore.

---

## 5. History Service
**Base URL:** `http://history-service:6770`
**Purpose:** Persists completed session records to Firestore. Called internally by the Collaboration Service (`handleUserEnded` / `handleSessionEnded`) after a session ends — not exposed to the frontend directly.

### Endpoints

#### `POST /history`
Save a session record to Firestore. Each user gets their own entry with their code snapshot.
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
    "endedAt": 1774020600.0,
    "submittedBy": "uid_A"
  }
  ```
- **Document ID:** `{sessionId}_{submittedBy}` — each user gets a separate Firestore document with their own `finalCode` snapshot.
- **Responses:**
  - `201 Created`: `{"detail": "saved"}`

#### `GET /history/{user_id}`
Retrieve all session records for a given user.
- **Responses:**
  - `200 OK`: Returns an array of session records where the user was either `user1_id` or `user2_id`.