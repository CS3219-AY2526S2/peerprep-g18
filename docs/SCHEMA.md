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

## M1: User Service (Schema) — Firestore

Collection: `Users`

| Field | Type | Remarks |
|---|---|---|
| (Document ID) | String | Firebase UID (`user_id`) |
| `username` | String | Editable (Unique, checked case-insensitively) |
| `email` | String | Editable (Unique, synced with Firebase Auth) |
| `avatar_id` | Integer | Editable |
| `role` | String | "User", "Admin", or "Root" |

Notes:
- `username` and `email` are used for identity.
- Passwords and email verification state are managed by Firebase Auth, not stored in this Firestore collection.
- `role` is also stored in Firebase Custom Claims for gateway-level RBAC.

---

## M3: Question Management (Schema) — Firestore

Collection: `Questions`

| Field | Type | Remarks |
|---|---|---|
| (Document ID) | String | `question_id` (UUID) |
| `title` | String | Editable |
| `topic` | String | Editable |
| `difficulty` | String | Editable |
| `statement` | String | Markdown description |
| `template` | String | Initial code template |
| `examples` | List[String] | Sample inputs/outputs |
| `constraints` | List[String] | Problem constraints |
| `hints` | List[String] | Progressive hints |

Notes:
- The Question Service supports filtering and random selection by topic and difficulty.

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
| `finalCode` | String | Code snapshot at the time this user left |
| `startedAt` | Float (Unix timestamp) | Session start time |
| `endedAt` | Float (Unix timestamp) | Time this user ended/disconnected |
| `submittedBy` | String | Firebase UID of the user this entry belongs to |

Notes:
- Stored in Firestore via the History Service (`backend/history-service/`).
- Each user gets their own history entry with a code snapshot from when **they** left the session.

## M4: Session State (Schema) — Redis (Ephemeral)

### redis-sessions
These keys exist during an active session and are deleted after session cleanup.

| Key Pattern | Type | Remarks |
|---|---|---|
| `session:{id}:meta` | String (JSON) | Session metadata. TTL: 2h |
| `active_session:{uid}` | String | Current `sessionId` for a user. TTL: 2h |
| `ticket:{uuid}` | String (JSON) | One-time WebSocket ticket (`{uid, sessionId}`). TTL: 60s |
| `lock:session_init:{uid_A}:{uid_B}` | String | SETNX leader election lock for session creation. |

### redis-auth
Used for cross-service authorization state.

| Key Pattern | Type | Remarks |
|---|---|---|
| `invalidated_user:{uid}` | String ("1") | Blacklisted user (deleted). Gateway returns 401. TTL: 1h |
| `stale_claims:{uid}` | String (Timestamp) | User was promoted. Gateway returns 403 if token is older. TTL: 1h |

### redis-matching
Managed by the Matching Service.

| Key Pattern | Type | Remarks |
|---|---|---|
| `queue:{topic}:{difficulty}` | List | UIDs waiting for a match. |
| `match_ticket:{uid}` | String | Temporary ticket used during match handoff. |

---

## Change Log (Optional)

- 2026-02-23: Initial schema drafted from D1 planning screenshots.
- 2026-03-20: Added M4 Session History (Firestore) and Session State (Redis) schemas.
- 2026-03-21: Updated session_history to per-user entries (`{sessionId}_{submittedBy}`). Added `submittedBy` field and `session:{id}:saved:{uid}` Redis key.
