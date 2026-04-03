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
| (Document ID) | String | `{sessionId}_{submittedBy}` — per-user entry |
| `sessionId` | String (UUID) | Original session ID |
| `user1_id` | String | Firebase UID of first matched user |
| `user2_id` | String | Firebase UID of second matched user |
| `questionId` | String | Foreign Key* (M3) |
| `topic` | String | e.g., “Strings” |
| `difficulty` | String | e.g., “Easy” |
| `title` | String | Question title, embedded at session creation |
| `statement` | String | Full question description |
| `examples` | Array of Strings | Example inputs/outputs |
| `constraints` | Array of Strings | Problem constraints |
| `hints` | Array of Strings | Optional hints |
| `finalCode` | String | Code snapshot at the time this user left |
| `startedAt` | Float (Unix timestamp) | Session start time |
| `endedAt` | Float (Unix timestamp) | Time this user ended/disconnected |
| `submittedBy` | String | Firebase UID of the user this entry belongs to |

Notes:
- Stored in Firestore via the History Service (`backend/history-service/`).
- Each user gets their own history entry with a code snapshot from when **they** left the session.
- If User A ends first and User B continues editing, User A's `finalCode` reflects the code at the time they left, while User B's `finalCode` includes their subsequent changes.
- A user's history is saved when they explicitly click “End Session” or when their 30-second disconnect timeout expires.
- Queried by `user1_id` or `user2_id` to retrieve a user's session history.

## M4: Session State (Schema) — Redis (Ephemeral)

These keys exist in `redis-sessions` only during an active session and are deleted after session cleanup.

| Key Pattern | Type | Remarks |
|---|---|---|
| `session:{id}:meta` | String (JSON) | Session metadata (user IDs, questionId, topic, difficulty, title, statement, examples, constraints, hints, startedAt). TTL: 2h |
| `session:{id}:ydoc` | List (base64 strings) | Yjs document update history for replay on reconnect |
| `session:{id}:finalCode` | String | Plaintext code snapshot, updated on every edit |
| `session:{id}:chat` | List (JSON strings) | Chat messages. Trimmed to last 500 |
| `ticket:{uuid}` | String (JSON) | One-time WebSocket ticket (uid + sessionId). TTL: 60s |
| `lock:match:{uid_A}:{uid_B}` | String | Leader election lock for session creation. TTL: 2h |
| `session:{id}:saved:{uid}` | String ("1") | Flag: user's history has been saved (prevents duplicate save on cleanup). TTL: 2h |

---

## Change Log (Optional)

- 2026-02-23: Initial schema drafted from D1 planning screenshots.
- 2026-03-20: Added M4 Session History (Firestore) and Session State (Redis) schemas.
- 2026-03-21: Updated session_history to per-user entries (`{sessionId}_{submittedBy}`). Added `submittedBy` field and `session:{id}:saved:{uid}` Redis key.
- 2026-04-03: Added `title`, `statement`, `examples`, `constraints`, `hints` to `session_history` and `session:{id}:meta`. Fields are fetched from Question Service at session creation and embedded to avoid cross-service lookups at read time.
