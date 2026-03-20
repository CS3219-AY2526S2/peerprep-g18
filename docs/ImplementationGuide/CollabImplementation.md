# M4 Collaboration Service — Phased Implementation Plan

**Owner:** Lee De En (M4 Collaboration)
**Scope:** `collaboration-service/`, `api-gateway/`, `nginx.conf`, `docker-compose.yml`, `history-service/` (new), `docs/API.md`
**Does NOT touch:** user-service, matching-service, question-service internals
**Status:** All phases complete (2026-03-20)

Each phase below is a self-contained, deployable, testable unit.

---

## Full Architecture

```
Frontend          Nginx            API Gateway         Collab Service   History Service
   |                |                   |                    |                |
   |--GET /matching/events (SSE)------->|                    |                |
   |                |     subscribe match_events:{uid} on Redis               |
   |                |     SETNX leader election + question fetch              |
   |<--SSE: {match_found, sessionId, questionId}             |                |
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
   |      [both disconnect → 30s timer]                      |                |
   |                |                   |    POST /internal/collab/session-ended
   |                |                   |<-------------------|                |
   |                |                   |   reads finalCode from Redis        |
   |                |                   |   POST /history ---------------------->|
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
- Follower polls for session meta (up to 10 retries, 100ms apart)

**1c. SSE endpoint** — `GET /matching/events`:
- Declared BEFORE catch-all proxy route
- Subscribes to `match_events:{uid}` on redis-event-bus
- Streams `match_found` / `timeout` events
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
//   connectedEditors: Set<string>,   // userIds
//   disconnectTimer: Timeout | null
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
- On `connection`: reads `socket.userId` and `socket.sessionId` (set by Phase 2 middleware), creates or loads Y.Doc from Redis, joins room, sends `yjs-sync` (full state), emits `user-joined` to partner
- On `yjs-update`: applies update to Y.Doc, persists as base64 to Redis (`RPUSH session:{id}:ydoc`), stores plaintext snapshot (`SET session:{id}:finalCode`), broadcasts to partner
- On `disconnect`: removes from `connectedEditors`, emits `user-left`, starts 30s cleanup timer if both users gone
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

**Deliverable:** When both users disconnect and the 30-second grace period expires, the session's final code and metadata are saved to Firestore, then all Redis keys are deleted.

### New service created: `backend/history-service/`

**Files created:**
- `backend/history-service/Dockerfile` — Python 3.11 slim, uvicorn on port 6770
- `backend/history-service/requirements.txt` — fastapi, uvicorn[standard], firebase-admin
- `backend/history-service/main.py` — two endpoints
- `backend/history-service/firebase-history-account.json` — Firebase service account (gitignored)

**`POST /history`** — saves session record to Firestore `session_history` collection:
```python
@app.post("/history", status_code=201)
async def save_history(payload: dict):
    db.collection("session_history").document(payload["sessionId"]).set(payload)
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
- `backend/api-gateway/main.py` — added `POST /internal/collab/session-ended/{session_id}`

**API Gateway cleanup endpoint** — called by collab service's 30s disconnect timer:
```python
@app.post("/internal/collab/session-ended/{session_id}")
async def session_ended(session_id: str):
    raw = await redis_sessions.get(f"session:{session_id}:meta")
    if not raw:
        return {"detail": "Already cleaned up"}
    meta = json.loads(raw)
    final_code = await redis_sessions.get(f"session:{session_id}:finalCode") or ""

    history_payload = {
        **meta,
        "sessionId": session_id,
        "finalCode": final_code,
        "endedAt": time.time()
    }
    await http_client.post("http://history-service:6770/history", json=history_payload)

    await redis_sessions.delete(
        f"session:{session_id}:meta",
        f"session:{session_id}:finalCode",
        f"session:{session_id}:ydoc",
        f"session:{session_id}:chat"
    )
    return {"detail": "Session ended and history saved"}
```

### Firestore record format
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

## Summary Table

| Phase | What shipped | Status |
|---|---|---|
| 0 | `redis-sessions` container | COMPLETE |
| 1 | SSE match events + session creation in Redis | COMPLETE |
| 2 | Ticket auth via collab service middleware | COMPLETE |
| 3 | Yjs collab editor + chat + Redis persistence | COMPLETE |
| 4 | History service + session cleanup | COMPLETE |
| 5 | API documentation in `docs/API.md` | COMPLETE |

## Key Context

- **Firebase UID:** `wxXcHekDciRUxsqyJqyTvHDDbh72`
- **Token location:** Browser localStorage key `peerprep_token`
- **Token expiry:** 1 hour — get a fresh one from the frontend before testing
- **Test topic/difficulty that exists in Firestore:** `Strings` / `Easy`
- **Test publish script:** `docker exec -it api-gateway python3 /app/test_publish.py`
- **Matching service publishes to:** `match_events:{uid}` on `redis-event-bus`
- **nginx config reload:** `docker exec -it nginx nginx -s reload` (needed when nginx.conf changes since nginx uses pre-built image)
