# Database Schema (Planned; Subject to Change)

This document records our **current** database schema plan for selected PeerPrep microservices (and a Nice-to-have).  
**Important:** These schemas are **work-in-progress** and may change as we refine requirements/design and implement the system; they should not be treated as the final implementation unless updated again near final submission. 

---

## Conventions

- IDs are represented as `UUID` across services (subject to implementation constraints).  
- “Editable” indicates fields that can be modified through service APIs/admin tooling (as planned).  
- Cross-service references are described as “Foreign Key*” because strict foreign keys may not be enforceable across microservice databases; referential integrity may be maintained at the application level.
    - **Additional sidenote:** The possibility of a *"schema-per-service"* within a *shared database instance* could be viable, although it reduces re-usability across modules due to domain-level dependencies (Refer to **L5.2-Architecture.pdf** for more information).

---

## M1: User Service (Schema)

Planned table: `Users`

| Field | Type | Remarks |
|---|---|---|
| `UserID` | UUID | Primary Key (Incremental)* |
| `Username` | String | Editable (Unique) |
| `Email` | String | Editable (Unique) |
| `HashedPassword` | String | Editable (Hashed) |
| `Salt` | String | Generated |
| `AvatarID` | Integer | Editable |
| `Role` | String | Editable (Enum) |

Notes:
- `Username` and `Email` are intended to be unique identifiers for login/identity. 
- `Role` supports role-based access control (RBAC) at the User Service level (exact roles to be finalized). 

---

## M3: Question Management (Schema)

Planned table: `Questions`

| Field | Type | Remarks |
|---|---|---|
| `QuestionID` | UUID | Primary Key |
| `TopicTag` | String (e.g., "Array") | Editable (Enum) |
| `DifficultyTag` | String (e.g., "Easy") | Editable (Enum) |
| `Description` | String | Editable |
| `Hint` | String | Editable |
| `CodeTemplate` | String | Editable |

Notes:
- The Question Service is expected to support storing and retrieving questions by difficulty/topic, and provide question details during session initiation. 
- `Description`/`Hint` may later support markdown formatting and/or richer content depending on implementation. 

---

## M4: Session History (Schema) — Firestore

Collection: `session_history` (History Service — Firestore)

| Field | Type | Remarks |
|---|---|---|
| `sessionId` | String (UUID) | Document ID |
| `user1_id` | String | Firebase UID of first matched user |
| `user2_id` | String | Firebase UID of second matched user |
| `questionId` | String | Foreign Key* (M3) |
| `topic` | String | e.g., “Strings” |
| `difficulty` | String | e.g., “Easy” |
| `finalCode` | String | Final code snapshot at session end |
| `startedAt` | Float (Unix timestamp) | Session start time |
| `endedAt` | Float (Unix timestamp) | Session end time (after 30s grace period) |

Notes:
- Stored in Firestore via the History Service (`backend/history-service/`).
- Records are created automatically when both users disconnect and the 30-second grace period expires.
- `finalCode` is a plaintext snapshot of the Yjs shared document at the time of session end.
- Queried by `user1_id` or `user2_id` to retrieve a user's session history.

## M4: Session State (Schema) — Redis (Ephemeral)

These keys exist in `redis-sessions` only during an active session and are deleted after session cleanup.

| Key Pattern | Type | Remarks |
|---|---|---|
| `session:{id}:meta` | String (JSON) | Session metadata (user IDs, questionId, topic, difficulty, startedAt). TTL: 2h |
| `session:{id}:ydoc` | List (base64 strings) | Yjs document update history for replay on reconnect |
| `session:{id}:finalCode` | String | Plaintext code snapshot, updated on every edit |
| `session:{id}:chat` | List (JSON strings) | Chat messages. Trimmed to last 500 |
| `ticket:{uuid}` | String (JSON) | One-time WebSocket ticket (uid + sessionId). TTL: 60s |
| `lock:match:{uid_A}:{uid_B}` | String | Leader election lock for session creation. TTL: 2h |

---

## Change Log (Optional)

- 2026-02-23: Initial schema drafted from D1 planning screenshots.
- 2026-03-20: Added M4 Session History (Firestore) and Session State (Redis) schemas.
