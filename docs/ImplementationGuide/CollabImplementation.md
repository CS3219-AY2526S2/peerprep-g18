# M4 Collaboration Service — Phased Implementation Plan

**Owner:** Lee De En (M4 Collaboration)
**Scope:** `collaboration-service/`, `api-gateway/`, `nginx.conf`, `docker-compose.yml`, `history-service/` (new), `docs/API.md`
**Does NOT touch:** user-service, matching-service, question-service internals
**Status:** All phases complete (2026-03-21)

Each phase below is a self-contained, deployable, testable unit.

---

## Full Architecture

```
Frontend          Nginx            API Gateway         Collab Service   History Service
   |                |                   |                    |                |
   |--GET /matching/events (SSE)------->|                    |                |
   |                |     subscribe match_events:{uid} on Redis               |
   |                |     SETNX leader election + question fetch              |
   |<--SSE: event:match_found {sessionId, questionId}        |                |
   |                |                   |                    |                |
   |--POST /api/collab/join (JWT)------->|                   |                |
   |<--{ ticket: UUID }                 |                    |                |
   |                |                   |                    |                |
   |--WS /socket.io/?ticket=UUID------->|                    |                |
   |                |--proxy upgrade (no auth_request)------>|                |
   |                |                   |    GETDEL ticket:{UUID} from Redis  |
   |                |                   |    attach uid+sessionId to socket   |
   |<===================== Yjs editor + chat over Socket.IO ================>|
   |                |                   |                    |                |
   |  [User A ends or disconnects 30s]  |                    |                |
   |                |                   |    snapshot code    |                |
   |                |                   |    POST /internal/collab/user-ended |
   |                |                   |<-------------------|                |
   |                |                   |   save User A's history ------------>|
   |                |                   |   SET saved:{uid_A} flag            |
   |                |                   |                    |                |
   |                |                   |    emit 'partner-ended' to User B   |
   |  [User B prompted: Continue/End]   |                    |                |
   |  [User B continues solo editing]   |                    |                |
   |  [User B ends → same flow]         |                    |                |
   |                |                   |                    |                |
   |  [all disconnected → cleanup]      |    POST /internal/collab/session-ended
   |                |                   |<-------------------|                |
   |                |                   |   save history for unsaved users -->|
   |                |                   |   DEL all session:{id}:* keys       |
```

---

## Phase 0 — Infrastructure
**Status: COMPLETE**

**Deliverable:** `redis-sessions` container running alongside existing services.

### Files changed
- `backend/docker-compose.yml`

### What was done
Added `redis-sessions` service:
```yaml
redis-sessions:
  image: redis:7-alpine
  container_name: redis-sessions
  expose:
    - "6379"
```

Updated `api-gateway`:
```yaml
depends_on:
  - redis-sessions
environment:
  - REDIS_SESSIONS_HOST=redis-sessions
```

### Tests passed
- `docker exec -it redis-sessions redis-cli ping` → `PONG`

---

## Phase 1 — SSE Match Notification + Session Creation (API Gateway)
**Status: COMPLETE**

**Deliverable:** After two users are matched, both receive a `match_found` SSE event containing `sessionId` and `questionId`. The session is stored in `redis-sessions`.

### Files changed
- `backend/api-gateway/requirements.txt` — added `redis[asyncio]>=5.0`
- `backend/api-gateway/main.py` — Redis startup + SSE endpoint + session creation helper

### What was done

**1a. Redis startup** — two async Redis clients initialized on startup:
- `redis_sessions` → `redis-sessions` container (tickets + session metadata)
- `redis_events` → `redis-event-bus` container (match/timeout events from matching service)

**1b. Session creation helper** — `create_or_join_session()`:
- Leader election via `SETNX` on `lock:match:{sorted_uids}`
- Leader calls question service internally (`GET http://question-service:6768/question/`)
- Stores session meta in Redis with 2h TTL
- Follower polls for session meta (up to 50 retries, 200ms apart — 10s window)

**1c. SSE endpoint** — `GET /matching/events`:
- Declared BEFORE catch-all proxy route
- Subscribes to `match_events:{uid}` on redis-event-bus
- Streams `match_found` / `timeout` events using proper SSE `event:` field (not embedded in JSON `data`)
- Includes JSON error handling (Git Bash on Windows injects control characters)

**1d. Session meta endpoint** — `GET /collab/session/{session_id}`:
- Returns session metadata, enforces membership check

**Other changes:**
- Removed `"collab"` from `SERVICES` routing table (collab HTTP endpoints live in gateway)
- Added `client_header_buffer_size 4k` to nginx.conf (JWT tokens exceed default 1k buffer)

### Key decisions
| Decision | Reason |
|---|---|
| Removed `"collab"` from SERVICES | Collab HTTP endpoints live in gateway; WebSocket bypasses gateway entirely |
| Used `SETNX` for leader election | Prevents two gateway instances from creating two sessions for the same match |
| JSON error handling in SSE stream | Git Bash on Windows injects control characters; production matching service publishes clean JSON |

### Tests passed
- SSE connects → `{"event":"connected"}`
- Match event published → SSE receives `{"event":"match_found","sessionId":"...","questionId":"..."}`
- Redis contains correct session metadata
- `GET /api/collab/session/{sessionId}` returns full metadata

### Test helper
Created `backend/api-gateway/test_publish.py` to publish mock match events:
```python
import asyncio, json
from redis.asyncio import Redis

async def pub():
    r = Redis(host='redis-event-bus', port=6379, decode_responses=True)
    data = json.dumps({
        'event': 'match',
        'user1_id': 'wxXcHekDciRUxsqyJqyTvHDDbh72',
        'user2_id': 'other_uid',
        'topic': 'Strings',
        'difficulty': 'Easy'
    })
    result = await r.publish('match_events:wxXcHekDciRUxsqyJqyTvHDDbh72', data)
    print(f"Published to {result} subscriber(s)")
    await r.aclose()

asyncio.run(pub())
```
Run with: `docker exec -it api-gateway python3 /app/test_publish.py`

---

## Phase 2 — Ticket-Based WebSocket Auth (API Gateway + Collab Service)
**Status: COMPLETE**

**Deliverable:** Socket.IO connections require a valid one-time ticket. Connections without a ticket are rejected by the collab service's Socket.IO middleware.

> **Design change from original plan:** The original plan used nginx `auth_request` to validate tickets before proxying WebSocket connections. Testing revealed that nginx's `auth_request` module interferes with WebSocket upgrade requests (HTTP 101) — all connections returned 401 even after the auth subrequest succeeded. Root cause: `auth_request` subrequests don't properly hand off to the WebSocket upgrade flow. Additionally, `$request_uri` in subrequest context returns the subrequest's own URI, not the original request URI containing the ticket.
>
> **Solution:** Moved ticket validation into the collab service's Socket.IO middleware. Nginx acts as a plain WebSocket proxy. This is simpler, more reliable, and aligns better with Phase 3 (collab service already needs Redis for Yjs persistence).

### Files changed
- `backend/api-gateway/main.py` — added `POST /collab/join` (ticket issuance) and `GET /internal/validate` (kept but unused, superseded by collab middleware)
- `backend/collaboration-service/package.json` — added `redis` dependency
- `backend/collaboration-service/server.js` — added Redis client + Socket.IO auth middleware
- `backend/docker-compose.yml` — added `redis-sessions` dependency + env var to collab-service
- `backend/nginx.conf` — kept `/socket.io/` as plain WebSocket proxy (removed all `auth_request` directives)

### What was done

**2a. Ticket issuance** — `POST /collab/join` in API Gateway:
- Verifies Firebase JWT
- Checks session membership (`uid` must be `user1_id` or `user2_id`)
- Issues a one-time ticket (UUID) stored in Redis with 60s TTL
- Ticket payload: `{"uid": "...", "sessionId": "..."}`

**2b. Socket.IO auth middleware** in collab service:
```javascript
async function ticketMiddleware(socket, next) {
  const ticket = socket.handshake.query.ticket;
  if (!ticket) return next(new Error('No ticket provided'));
  const val = await redisClient.getDel(`ticket:${ticket}`);
  if (!val) return next(new Error('Invalid or expired ticket'));
  const data = JSON.parse(val);
  socket.userId = data.uid;
  socket.sessionId = data.sessionId;
  next();
}
```
- Uses `GETDEL` for one-time consumption
- Attaches `userId` and `sessionId` to the socket object for use by namespaces

**2c. Nginx** — plain WebSocket proxy:
```nginx
location /socket.io/ {
    set $upstream_collab collab-service;
    proxy_pass http://$upstream_collab:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

**2d. docker-compose.yml** — collab-service depends on redis-sessions:
```yaml
collab-service:
  depends_on:
    - redis-sessions
  environment:
    - REDIS_SESSIONS_HOST=redis-sessions
```

**Note:** After modifying nginx.conf, must reload nginx (`docker exec -it nginx nginx -s reload`) or recreate the container. `docker-compose up --build` only rebuilds services with a `build:` directive — nginx uses a pre-built image so `--build` alone doesn't reload its config.

### Tests passed
- `POST /api/collab/join` with valid JWT + valid sessionId → `{"ticket": "uuid"}`
- Connect Socket.IO with valid ticket → `SUCCESS: <socket_id>` (HTTP 101)
- Connect with no ticket → rejected with "No ticket provided"
- Reuse same ticket → rejected with "Invalid or expired ticket"

---

## Phase 3 — Collaboration Service (Yjs Editor + Chat)
**Status: COMPLETE**

**Deliverable:** Two authenticated users can collaboratively edit code in real time (Yjs CRDT) and chat. State persists across page refreshes via Redis.

### Files changed
- `backend/collaboration-service/package.json` — added `yjs`, `axios` dependencies
- `backend/collaboration-service/server.js` — complete rewrite

### What was done

**Full rewrite of `server.js`** with the following architecture:

**In-memory session state:**
```javascript
const sessions = new Map()
// sessions.get(sessionId) = {
//   ydoc: Y.Doc,
//   connectedEditors: Set<string>,       // userIds
//   userDisconnectTimers: Map<string, Timeout>,  // per-user 30s disconnect timers
//   disconnectTimer: Timeout | null       // full session cleanup timer
// }
```

**Socket.IO namespaces** — ticket middleware applied to both:
```javascript
const editorNs = io.of('/editor')
const chatNs = io.of('/chat')
editorNs.use(ticketMiddleware)
chatNs.use(ticketMiddleware)
```

**`/editor` namespace:**
- On `connection`: reads `socket.userId` and `socket.sessionId` (set by Phase 2 middleware), creates or loads Y.Doc from Redis, joins room, sends `yjs-sync` (full state), emits `user-joined` to partner AND notifies new joiner about existing users already in the room
- On `yjs-update`: applies update to Y.Doc, persists as base64 to Redis (`RPUSH session:{id}:ydoc`), stores plaintext snapshot (`SET session:{id}:finalCode`), broadcasts to partner
- On `end-session`: snapshots code, calls `POST /internal/collab/user-ended/{sessionId}` to save this user's history, emits `partner-ended` to remaining users
- On `disconnect`: removes from `connectedEditors`, emits `user-left`, starts 30s per-user timer. If timer expires without reconnect, treats as end-session (snapshot + save + `partner-ended`). If all users gone after per-user timers fire, starts session cleanup timer
- Cleanup timer fires: `POST http://api-gateway:1234/internal/collab/session-ended/{sessionId}`, deletes in-memory session

**`/chat` namespace:**
- On `connection`: joins room, loads last 50 messages from Redis (`LRANGE session:{id}:chat -50 -1`), emits `chat-history`
- On `send-message`: sanitizes HTML (`text.replace(/[<>]/g, '')`), persists to Redis (`RPUSH`), trims to last 500 messages (`LTRIM`), broadcasts `receive-message` to room

**Yjs persistence strategy:**
- Each Yjs update is stored as a base64-encoded string in a Redis list (`session:{id}:ydoc`)
- On reconnect/new session load, all updates are replayed: `LRANGE 0 -1` → `Y.applyUpdate()` for each
- A plaintext `finalCode` snapshot is maintained separately for the history service

### Tests passed
- Editor: connect → `SYNCED`, insert text → `ytext.toString()` returns correct value
- Redis: `GET session:{id}:finalCode` returns the typed text
- Chat: connect → `HISTORY: []`, send message → `MSG: {sender, text, time}` received
- Chat persistence: reconnect → `HISTORY:` contains previous messages

---

## Phase 4 — Session History + Cleanup
**Status: COMPLETE**

**Deliverable:** Each user gets their own history entry with a code snapshot from when they left. When all users are gone and grace periods expire, remaining unsaved users' history is written and Redis keys are cleaned up.

### New service created: `backend/history-service/`

**Files created:**
- `backend/history-service/Dockerfile` — Python 3.11 slim, uvicorn on port 6770
- `backend/history-service/requirements.txt` — fastapi, uvicorn[standard], firebase-admin
- `backend/history-service/main.py` — two endpoints
- `backend/history-service/firebase-history-account.json` — Firebase service account (gitignored)

**`POST /history`** — saves per-user session record to Firestore `session_history` collection:
```python
@app.post("/history", status_code=201)
async def save_history(payload: dict):
    session_id = payload["sessionId"]
    submitted_by = payload.get("submittedBy", "")
    doc_id = f"{session_id}_{submitted_by}" if submitted_by else session_id
    db.collection("session_history").document(doc_id).set(payload)
    return {"detail": "saved"}
```

**`GET /history/{user_id}`** — lists all sessions for a user (queries both `user1_id` and `user2_id`):
```python
@app.get("/history/{user_id}")
async def get_history(user_id: str):
    docs = db.collection("session_history").where("user1_id", "==", user_id).stream()
    docs2 = db.collection("session_history").where("user2_id", "==", user_id).stream()
    results = [d.to_dict() for d in docs] + [d.to_dict() for d in docs2]
    return results
```

### Other files changed
- `backend/docker-compose.yml` — added `history-service` container (port 6770)
- `backend/api-gateway/main.py` — added `POST /internal/collab/user-ended/{session_id}` and `POST /internal/collab/session-ended/{session_id}`

**API Gateway per-user history endpoint** — called by collab service when a user ends or disconnects (30s timeout):
```python
@app.post("/internal/collab/user-ended/{session_id}")
async def user_ended(session_id: str, request: Request):
    body = await request.json()
    user_id = body["userId"]
    final_code = body.get("finalCode", "")
    # ... reads session meta, saves to history with submittedBy field
    # Sets session:{id}:saved:{uid} flag to prevent duplicate save on cleanup
```

**API Gateway cleanup endpoint** — called by collab service when all users are gone:
```python
@app.post("/internal/collab/session-ended/{session_id}")
async def session_ended(session_id: str):
    # ... reads session meta
    # For each user, checks session:{id}:saved:{uid} flag
    # Only saves history for users who haven't been saved yet
    # Deletes all session:{id}:* keys including saved flags
```

### Firestore record format
Document ID: `{sessionId}_{submittedBy}` (each user gets their own entry)
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

### Tests passed
- Connect to editor → type code → disconnect → wait 30s
- Collab service logs: `[cleanup] Session ... cleaned up`
- Firestore: `session_history` document contains correct `finalCode`, user IDs, question info
- Redis: `KEYS session:{id}:*` returns empty
- `GET /history/{user_id}` returns the saved session record

---

## Phase 5 — API Documentation
**Status: COMPLETE**

**Deliverable:** Collaboration and history service documentation added to `docs/API.md` (sections 4 and 5), following the team's existing API documentation style.

### What was done
- Added **Section 4: Collaboration Service** to `docs/API.md`:
  - API Gateway collab endpoints (SSE, session metadata, ticket issuance)
  - Editor namespace (`/editor`) events and frontend integration code
  - Chat namespace (`/chat`) events and frontend integration code
  - Reconnect flow
  - Session lifecycle
- Added **Section 5: History Service** to `docs/API.md`
- Updated PlantUML diagrams (`docs/plantUML/collab.puml`, `docs/plantUML/matchToCollab.puml`) to reflect the actual implementation (collab service validates tickets, not nginx)

---

## Phase 6 — Graceful Session End + Per-User History
**Status: COMPLETE**

**Deliverable:** When a user ends a session (or disconnects for 30s), their code is snapshotted and saved individually. The partner is prompted to continue or end. Each user gets their own history entry.

### Files changed
- `backend/collaboration-service/server.js` — end-session handler, per-user disconnect timers, user-joined for existing users
- `backend/api-gateway/main.py` — SSE `event:` field fix, follower polling timeout (1s→10s), new `POST /internal/collab/user-ended/{session_id}`, updated `session-ended` to skip already-saved users
- `backend/history-service/main.py` — per-user document IDs (`{sessionId}_{submittedBy}`)
- `frontend/src/components/CollaborationPage.tsx` — `partner-ended` modal (Continue/End), `end-session` emit, partner status fixes
- `frontend/src/components/MatchingPage.tsx` — SSE event type handling fix

### What was done

**6a. SSE format fix** — SSE events now use proper `event:` field (`event: match_found\ndata: {...}`) instead of embedding event type in JSON data. Frontend `fetchEventSource` reads `event.event` for routing.

**6b. Session creation reliability** — Follower polling timeout increased from 1s (10×0.1s) to 10s (50×0.2s). Added try/except around `create_or_join_session` in SSE generator to prevent `RuntimeError: response already started`.

**6c. Explicit end-session flow** — When a user clicks "End Session":
1. Frontend emits `end-session` to collab service
2. Collab service snapshots `ydoc.getText('code')`, calls `POST /internal/collab/user-ended/{sessionId}` with the snapshot
3. API gateway saves the user's history entry (Firestore doc: `{sessionId}_{userId}`) and sets a `session:{id}:saved:{uid}` Redis flag
4. Collab service emits `partner-ended` to the room

**6d. Disconnect-as-end-session** — When a user disconnects without clicking End:
1. `user-left` emitted immediately (partner sees "Reconnecting...")
2. 30-second per-user timer starts (`userDisconnectTimers` map)
3. If user reconnects within 30s → timer cancelled, `user-joined` emitted, back to normal
4. If timer expires → same flow as explicit end-session (snapshot + save + `partner-ended`)

**6e. Partner prompt modal** — When `partner-ended` is received:
- Modal displayed: "Your partner ended the session. Continue or End?"
- **Continue:** modal dismissed, editor + chat remain functional, partner status shows "Partner has left"
- **End:** `end-session` emitted (saves this user's history), sockets disconnected, navigate to dashboard

**6f. Per-user history** — History service now uses `{sessionId}_{submittedBy}` as Firestore document ID. Session cleanup (`session-ended`) checks `session:{id}:saved:{uid}` flags and only saves history for users not already saved.

**6g. User-joined for existing users** — On editor connect, the new joiner receives `user-joined` events for users already in the session (previously only existing users were notified about new joiners).

### Key decisions
| Decision | Reason |
|---|---|
| Per-user 30s disconnect timer (not one global timer) | Each user should be treated independently — User A disconnecting shouldn't force User B out |
| `partner-ended` vs `session-ended` event | `partner-ended` prompts user to choose; `session-ended` was auto-redirecting without choice |
| SSE `event:` field | `@microsoft/fetch-event-source` exposes SSE event type via `event.event`, not from JSON body |
| Follower 10s polling (was 1s) | Question service call takes 2-3s; 1s window caused Session init timeout for the follower |
| Redis `saved:{uid}` flag | Prevents duplicate history writes when cleanup runs after user already saved via end-session |

---

## Summary Table

| Phase | What shipped | Status |
|---|---|---|
| 0 | `redis-sessions` container | COMPLETE |
| 1 | SSE match events + session creation in Redis | COMPLETE |
| 2 | Ticket auth via collab service middleware | COMPLETE |
| 3 | Yjs collab editor + chat + Redis persistence | COMPLETE |
| 4 | History service + session cleanup | COMPLETE |
| 5 | API documentation in `docs/API.md` | COMPLETE |
| 6 | Graceful session end + per-user history | COMPLETE |

## Key Context

- **Firebase UID:** `wxXcHekDciRUxsqyJqyTvHDDbh72`
- **Token location:** Browser localStorage key `peerprep_token`
- **Token expiry:** 1 hour — get a fresh one from the frontend before testing
- **Test topic/difficulty that exists in Firestore:** `Strings` / `Easy`
- **Test publish script:** `docker exec -it api-gateway python3 /app/test_publish.py`
- **Matching service publishes to:** `match_events:{uid}` on `redis-event-bus`
- **nginx config reload:** `docker exec -it nginx nginx -s reload` (needed when nginx.conf changes since nginx uses pre-built image)
