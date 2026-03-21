# PRD: Connect Collaboration Service Backend to Frontend

## Context
The collaboration service backend (Phases 0-5) is complete: matching -> SSE -> ticket auth -> Yjs editor + chat -> history cleanup. The frontend currently uses **mocked matching** (random 3-5s delay) and **mocked collaboration** (textarea with non-functional socket events using wrong protocol). This plan wires the real backend to the frontend in testable phases.

---

## New Dependencies to Install
```bash
npm install yjs y-codemirror.next @microsoft/fetch-event-source react-router-dom sonner
```
| Package | Purpose |
|---|---|
| `yjs` | CRDT library for collaborative editing |
| `y-codemirror.next` | Binds Yjs to CodeMirror 6 |
| `@microsoft/fetch-event-source` | Fetch-based SSE with JWT header support + auto-reconnect |
| `react-router-dom` | URL-driven routing for all pages |
| `sonner` | Lightweight toast notifications |

**Already installed**: `socket.io-client`, `@uiw/react-codemirror`, `@codemirror/lang-python`, `@uiw/codemirror-theme-dracula`, `react-markdown`, `remark-math`, `rehype-katex`

---

## Phase 1: React Router Migration + Protected Routes

### Goal
Replace useState-based page navigation with React Router. Add ProtectedRoute wrapper for authenticated pages. All existing functionality preserved.

### Files Modified
| File | Changes |
|---|---|
| `frontend/src/App.tsx` | Replace conditional rendering with `<BrowserRouter>` + `<Routes>`. Create `<ProtectedRoute>` component that checks auth and redirects to `/auth`. |
| `frontend/src/components/LandingPage.tsx` | Replace `onGetStarted` callback with `useNavigate()` to `/auth` |
| `frontend/src/components/AuthPage.tsx` | Replace `onBack`/`onLoginSuccess` callbacks with `useNavigate()` |
| `frontend/src/components/Dashboard.tsx` | Replace `onStartMatching`/`onProfileClick`/`onLogout` with `useNavigate()` |
| `frontend/src/components/MatchingPage.tsx` | Replace `onMatchFound`/`onTimeout`/`onCancel` with `useNavigate()` |
| `frontend/src/components/CollaborationPage.tsx` | Replace `onEndSession` with `useNavigate()` |
| `frontend/src/components/ProfilePage.tsx` | Replace `onBack`/`onLogout` with `useNavigate()` |
| `frontend/src/components/AdminPage.tsx` | Replace `onLogout` with `useNavigate()` |

### Route Structure
```
/                    -> LandingPage
/auth                -> AuthPage
/dashboard           -> ProtectedRoute -> Dashboard
/profile             -> ProtectedRoute -> ProfilePage
/admin               -> ProtectedRoute -> AdminPage
/matching            -> ProtectedRoute -> MatchingPage
/session/:sessionId  -> ProtectedRoute -> CollaborationPage
```

### Key Design Decisions
- **ProtectedRoute** checks Firebase auth state. If not authenticated, redirects to `/auth`.
- **User state** stays in App.tsx context (or a simple React context) since multiple pages need it.
- **Session/matching state** passed via React Router's `useLocation().state` or URL params.
- The `/session/:sessionId` URL enables reconnect on page refresh — sessionId is in the URL.

### Test (Phase 1)
1. Navigate to each page via URL bar — correct page renders
2. Unauthenticated access to `/dashboard` redirects to `/auth`
3. Login flow works: `/auth` -> `/dashboard` (or `/admin` for admin users)
4. Browser back/forward buttons work
5. Page refresh on `/dashboard` rehydrates auth and stays on dashboard
6. Existing mock matching still works (navigate to `/matching` -> auto-navigates to `/session/:id`)

---

## Phase 2: MatchingPage — Real Backend Integration

### Goal
Replace mock matching with real `POST /matching/find-pair` + SSE stream via `@microsoft/fetch-event-source`.

### Files Modified
| File | Changes |
|---|---|
| `frontend/src/components/MatchingPage.tsx` | Full rewrite of matching logic |

### Implementation
1. **On mount**:
   - Open SSE stream first via `fetchEventSource(GATEWAY_URL + '/matching/events', { headers: { Authorization: Bearer ${token} } })`
   - Then call `POST ${GATEWAY_URL}/matching/find-pair` with body `{ topic_options: criteria.topics, difficulty_options: criteria.difficulties }` + `Authorization` header
2. **SSE event handling**:
   - `connected` -> SSE stream is live (no UI change needed)
   - `match_found` -> receive `{ sessionId, questionId }` -> navigate to `/session/${sessionId}`
   - `timeout` -> navigate back to `/dashboard` with toast "No match found"
3. **Cancel**: call `DELETE ${GATEWAY_URL}/matching/cancel-pair` + close SSE reader + navigate to `/dashboard`
4. **Cleanup on unmount**: abort SSE fetch controller + cancel if still matching

### Data Flow Change
- MatchingPage no longer builds the session object. It only receives `{ sessionId, questionId }` from SSE.
- The CollaborationPage (Phase 4) will fetch session/question/partner data itself using the sessionId from the URL.

### Test (Phase 2)
1. Start Docker backend (`docker-compose up --build`)
2. Login with user A -> select difficulty/topic -> click "Find a Peer"
3. Verify POST /matching/find-pair is called (check network tab)
4. Verify SSE stream opens and receives `connected` event
5. Open incognito -> login with user B -> same selections -> click "Find a Peer"
6. Both users should receive `match_found` SSE and navigate to `/session/:sessionId`
7. Cancel during matching -> calls DELETE /cancel-pair -> returns to dashboard
8. Wait 60s without match -> timeout event -> returns to dashboard with toast

---

## Phase 3: CollaborationPage — Ticket Auth + Yjs + CodeMirror Editor

### Goal
Wire up the `/editor` namespace with ticket-based auth and Yjs+CodeMirror for real-time collaborative code editing.

### Files Modified
| File | Changes |
|---|---|
| `frontend/src/components/CollaborationPage.tsx` | Major rewrite: session data fetching, ticket auth, Yjs+CodeMirror, partner status |

### Implementation

#### 3a. Session Data Fetching (on mount, using sessionId from URL)
1. Extract `sessionId` from `useParams()`
2. Fetch session metadata: `GET ${GATEWAY_URL}/collab/session/${sessionId}` -> `{ user1_id, user2_id, questionId, topic, difficulty, startedAt }`
3. Fetch question: `GET ${GATEWAY_URL}/question/${questionId}` -> full question with markdown description
4. Determine partner UID, fetch profile: `GET ${GATEWAY_URL}/users/${partnerUid}` -> `{ username, email, avatar_id }`
5. Render question with `react-markdown` + `remark-math` + `rehype-katex`
6. Session timer uses `startedAt` from metadata for accurate elapsed time

#### 3b. Ticket Acquisition + Editor Socket
1. Get ticket: `POST ${GATEWAY_URL}/collab/join` with `{ sessionId }` + JWT
2. Connect: `io('http://localhost/editor', { path: '/socket.io', query: { ticket }, transports: ['websocket'] })`

#### 3c. Yjs + CodeMirror Integration
```typescript
const ydoc = new Y.Doc()
const ytext = ydoc.getText('code')

// On socket events:
editorSocket.on('yjs-sync', (data) => Y.applyUpdate(ydoc, new Uint8Array(data)))
editorSocket.on('yjs-update', (data) => Y.applyUpdate(ydoc, new Uint8Array(data), 'remote'))

// On local changes:
ydoc.on('update', (update, origin) => {
  if (origin !== 'remote') editorSocket.emit('yjs-update', update)
})

// CodeMirror extensions:
extensions={[python(), dracula, yCollab(ytext)]}
```
- Replace textarea with `<CodeMirror>` component
- Python syntax highlighting (already installed)
- Dracula theme (already installed)
- `yCollab(ytext)` from `y-codemirror.next` for Yjs binding

#### 3d. Partner Status
- `user-joined` -> set partnerOnline = true
- `user-left` -> show "Partner reconnecting..." for 5s, then "Partner has left" if still gone
- Partner reconnects within 5s -> dismiss notification silently (Silent Reconnect)

#### 3e. Reconnect Flow (editor)
On editor socket `disconnect`:
1. Fetch new ticket via `POST /api/collab/join`
2. Update socket query: `editorSocket.io.opts.query.ticket = newTicket`
3. `editorSocket.connect()` — Yjs state is re-synced via `yjs-sync` event on reconnect

### Test (Phase 3)
1. After match, both users land on `/session/:sessionId`
2. Session metadata, question, and partner info render correctly
3. Type in editor on browser A -> text appears in browser B in real-time
4. Session timer shows accurate elapsed time from `startedAt`
5. Refresh browser A -> reconnects, code state is restored from Yjs sync
6. Partner disconnect -> "Reconnecting..." shown -> partner refreshes -> notification dismissed
7. Question renders with markdown formatting (code blocks, math)

---

## Phase 4: Chat Namespace Integration

### Goal
Wire up the `/chat` namespace for real-time messaging.

### Files Modified
| File | Changes |
|---|---|
| `frontend/src/components/CollaborationPage.tsx` | Add chat socket connection + event handlers |

### Implementation

#### 4a. Chat Socket Connection
1. Get second ticket: `POST ${GATEWAY_URL}/collab/join` with `{ sessionId }` + JWT
2. Connect: `io('http://localhost/chat', { path: '/socket.io', query: { ticket }, transports: ['websocket'] })`

#### 4b. Chat Events
- `chat-history` -> populate message list. Map `sender` (UID) to username using: if sender === user.uid -> user.username, else -> partner.username
- `receive-message` -> append to messages with same UID-to-username mapping
- Send: `chatSocket.emit('send-message', { text })` — server handles sender/time
- **No optimistic add** — server broadcasts to all room members including sender

#### 4c. Chat Reconnect
Same pattern as editor: fetch new ticket on disconnect -> reconnect -> `chat-history` restores messages

### Test (Phase 4)
1. Send message in browser A -> appears in both browsers
2. Chat history loads on connect (previous messages visible)
3. Refresh page -> chat reconnects, history reloads
4. Messages display correct usernames (not UIDs)
5. HTML injection is stripped (`<script>` tags etc.)

---

## Phase 5: End Session + Toast Notifications + Polish

### Goal
Wire up session end flow, add sonner toasts for all error/status notifications, final polish.

### Files Modified
| File | Changes |
|---|---|
| `frontend/src/App.tsx` | Add `<Toaster>` from sonner |
| `frontend/src/components/CollaborationPage.tsx` | End session cleanup, toast on errors |
| `frontend/src/components/MatchingPage.tsx` | Toast on timeout/errors |

### Implementation

#### 5a. End Session
- "End Session" button: disconnect both sockets, `ydoc.destroy()`, navigate to `/dashboard`
- Server-side 30s cleanup timer handles history persistence and Redis cleanup

#### 5b. Toast Notifications (sonner)
- Add `<Toaster />` in App.tsx root
- Matching timeout: `toast.info("No match found. Try again!")`
- SSE connection error: `toast.error("Connection lost. Retrying...")`
- Ticket fetch failure: `toast.error("Failed to connect. Retrying...")` + auto-retry with backoff
- Socket disconnect (non-refresh): `toast("Reconnecting...")`
- Socket reconnect success: `toast.success("Reconnected!")`

#### 5c. Error Recovery
- All network requests wrap in try/catch with toast + auto-retry (max 3 attempts, exponential backoff)
- If all retries fail: `toast.error("Connection failed")` + navigate to dashboard

### Test (Phase 5)
1. "End Session" -> both sockets disconnect -> navigate to dashboard
2. Wait 30s -> check Firestore for `session_history` document
3. Kill backend mid-session -> toast "Reconnecting..." appears -> restart backend -> reconnects
4. Matching timeout -> toast notification shown
5. All error scenarios show appropriate toasts

---

## Files Modified Summary (All Phases)

| File | Phase | Changes |
|---|---|---|
| `frontend/package.json` | 1 | Add all new dependencies |
| `frontend/src/App.tsx` | 1, 5 | React Router + ProtectedRoute + Toaster |
| `frontend/src/components/LandingPage.tsx` | 1 | useNavigate |
| `frontend/src/components/AuthPage.tsx` | 1 | useNavigate |
| `frontend/src/components/Dashboard.tsx` | 1 | useNavigate |
| `frontend/src/components/ProfilePage.tsx` | 1 | useNavigate |
| `frontend/src/components/AdminPage.tsx` | 1 | useNavigate |
| `frontend/src/components/MatchingPage.tsx` | 1, 2, 5 | useNavigate, real matching+SSE, toasts |
| `frontend/src/components/CollaborationPage.tsx` | 1, 3, 4, 5 | Major rewrite across phases |

## Files NOT Modified
- All backend services (complete)
- `frontend/src/constants.ts` (GATEWAY_URL already correct)
- `frontend/src/firebase.ts` (no changes needed)
