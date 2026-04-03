---
editor-width:
cssclasses:
  - wide-note
---
# Session End Scenarios

All possible ways a collaborative session can terminate, from both users' perspectives.

---

## Quick Reference

| # | Trigger | By | Partner sees | History saved |
|---|---------|-----|--------------|---------------|
| 1 | Click "End Session" | You | Modal: Stay / End | Immediately |
| 2 | Click "End Session" | Partner | Modal: Stay / End | Immediately |
| 3 | Close tab / navigate away, return < 30s | You | "Reconnecting..." → "Active now" | No (resumed) |
| 4 | Close tab / navigate away, return < 30s | Partner | "Reconnecting..." → "Active now" | No (resumed) |
| 5 | Close tab / navigate away, never return | You | "Reconnecting..." → modal after 30s | After 30s timeout |
| 6 | Close tab / navigate away, never return | Partner | "Reconnecting..." → modal after 30s | After 30s timeout |
| 7 | Network drop, recovers < 30s | Either | "Reconnecting..." → "Active now" | No (resumed) |
| 8 | Network drop, does not recover | Either | Same as close tab (scenarios 5/6) | After 30s timeout |
| 9 | Both disconnect simultaneously | Both | — | Each after 30s, Redis wiped after +5s |
| 10 | Stay alone after partner left, then close tab | You | — | After 30s timeout |
| 11 | Stay alone after partner left, click "End Session" | You | — | Immediately |

---

## Detailed Flow

```
╔══════════════════════════════════════════════════════════════════╗
║                    SESSION END — ALL SCENARIOS                   ║
╚══════════════════════════════════════════════════════════════════╝


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCENARIO 1 & 2 — Someone clicks "End Session"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [User A clicks End Session]
        │
        ├─ emit 'end-session' to server
        ├─ disconnect both sockets
        ├─ POST /collab/end-session  ──► clears active_session in Redis
        └─ navigate to /dashboard
        │
        ▼
  [Server receives 'end-session']
        ├─ snapshot finalCode from Yjs
        ├─ POST history-service      ──► User A's history saved
        ├─ del active_session:userA
        └─ emit 'partner-ended' ─────────────────────────────────┐
                                                                  ▼
                                                   [User B sees modal]
                                                    "Partner has left"
                                                    ├─ [Continue Coding]
                                                    │   modal closes, B stays alone
                                                    │   ──► Scenario 10 or 11
                                                    └─ [End Session]
                                                        ──► same flow as above
                                                            for User B


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCENARIO 3 & 4 — Close tab / navigate away, return < 30s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [User A closes tab or navigates away]
        │
        ▼
  React cleanup: editorSocket.disconnect()
        │
        ▼
  [Server: 'disconnect' event]
        ├─ remove A from connectedEditors
        ├─ emit 'user-left' ──────────────► [User B: status → "Reconnecting..."]
        └─ start 30s per-user timer
        │
        │  (User A reopens within 30s)
        ▼
  fetchTicket() → new WebSocket connection
        │
        ▼
  [Server: 'connection' event]
        ├─ cancel 30s timer
        ├─ re-add A to connectedEditors
        ├─ emit 'yjs-sync' ──────────────► User A gets full doc state back
        └─ emit 'user-joined' ───────────► [User B: status → "Active now"]
        │
        ▼
  Session continues normally, nothing saved


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCENARIO 5 & 6 — Close tab / navigate away, never return
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [User A closes tab or navigates away]
        │
        ▼
  React cleanup: editorSocket.disconnect()
        │
        ▼
  [Server: 'disconnect' event]
        ├─ emit 'user-left' ──────────────► [User B: status → "Reconnecting..."]
        └─ start 30s per-user timer
        │
        ▼ (30 seconds — no reconnect)
  [Timer fires]
        ├─ snapshot finalCode
        ├─ POST history-service      ──► User A's history saved
        ├─ del active_session:userA
        └─ emit 'partner-ended' ─────────────────────────────────┐
                                                                  ▼
                                                   [User B sees modal]
                                                    "Partner has left"
                                                    ├─ [Continue Coding]
                                                    │   B stays alone
                                                    │   ──► Scenario 10 or 11
                                                    └─ [End Session]
                                                        ──► Scenario 1/2 flow


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCENARIO 7 & 8 — Network drop
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [Network drops for User A]
        │
        ▼
  WebSocket connection lost (same server-side effect as close tab)
        │
        ├─ Recovers < 30s ──► same as Scenario 3 & 4
        │
        └─ Does not recover ──► same as Scenario 5 & 6

  Note: Frontend auto-reconnect (fetchTicket → socket.connect())
        is attempted on every 'disconnect' event unless
        sessionEndedRef is true.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCENARIO 9 — Both disconnect simultaneously
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [Both users disconnect around the same time]
        │
        ▼
  Both 30s per-user timers start independently
        │
        ▼ (both timers fire — up to 30s apart)
  For each user:
        ├─ history saved individually (idempotent, skip if already saved)
        └─ del active_session:userId
        │
        ▼ (connectedEditors.size === 0)
  [5s full session cleanup timer starts]
        │
        ▼
  handleSessionEnded()
        ├─ save history for any user not yet saved
        └─ delete all Redis keys:
            session:meta, finalCode, ydoc, chat,
            saved:user1, saved:user2,
            active_session:user1, active_session:user2


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SCENARIO 10 & 11 — User stays alone after partner left
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  User B chose [Continue Coding] after seeing partner-ended modal.
  partnerEndedRef = true on B's client.

  SCENARIO 10 — B then closes tab:
        │
        ▼
  editorSocket.disconnect()
        │
        ▼
  [Server: 'disconnect' event]
        ├─ no partner to notify (connectedEditors now empty)
        ├─ start 30s per-user timer for B
        └─ connectedEditors.size === 0 after timer:
            ──► 5s cleanup timer ──► handleSessionEnded()

  SCENARIO 11 — B clicks "End Session":
        │
        ▼
  Same as Scenario 1/2 but no partner to notify
        ├─ history saved immediately
        └─ navigate to /dashboard


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- No beforeunload handler: browser close/crash = WS disconnect (server-detected)
- Navigate away via React Router also triggers socket disconnect via useEffect cleanup
- sessionEndedRef = true blocks auto-reconnect after intentional End Session
- partnerEndedRef = true blocks "Reconnecting..." UI after partner explicitly left
- History is idempotent: session:saved:<userId> key prevents duplicate writes
- 30s grace period is per-user and independent; both can be in grace simultaneously
```
