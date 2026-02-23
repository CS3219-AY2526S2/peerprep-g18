# Product Backlog (PeerPrep)

> Context: PeerPrep is a technical interview prep + peer matching platform with core services: User, Matching, Question, Collaboration, plus UI and local deployment.

## Legend
- Type: FR (Functional Requirement), NFR (Non-Functional Requirement), N2H (Nice-to-have)
- Priority: High / Medium / Low
- Milestone: D1(backlog), D2(user+question decisions), D3(matching+collab+containerization decisions), D4(final demo)

---

## 1. Must-have (M1–M5) epics
> Keep these epics aligned to M1 User, M2 Matching, M3 Question, M4 Collaboration, M5 UI, M6 Local deployment.

### Epic M1 — User Service
- [ ] **F1** User can register and login.  
  Status: Not started | Priority: High | Milestone: D2 | Owner: @ | Due: YYYY-MM-DD 
  - [ ] **F1.1** Validate email/username/password during login. (Acceptance: invalid inputs rejected; errors shown)
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F1.2** Store passwords securely (hash + salt).  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F1.3** Email verification before matching (OTP or magic link).  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD

- [ ] **F2** User can edit profile information.  
  Status: Not started | Priority: Medium | Milestone: D2 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F2.1** Change password (requires validation).  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F2.2** Change username (must remain unique).  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

### Epic M2 — Matching Service
- [ ] **F3** Match users based on selected criteria (topic + difficulty).  
  Status: Not started | Priority: High | Milestone: D3 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F3.1** Create matching request and enqueue after topic/difficulty selection.  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F3.2** Pair exactly two users with same topic and difficulty.  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F3.3** Prevent self-match and multiple active requests per user.  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F3.4** Show number of active users queuing (overall).  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

- [ ] **F4** Manage matching state and wait times (notify/cancel/timeout).  
  Status: Not started | Priority: High | Milestone: D3 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F4.1** Notify user when match found.  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F4.2** Allow user to cancel before match found.  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F4.3** Remove matched users from queue.  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F4.4** Redirect matched users to collaboration space with unique session ID.  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD

### Epic M3 — Question Service
- [ ] **F5** Provide selectable topics and difficulty.  
  Status: Not started | Priority: High | Milestone: D2 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F5.1** Provide topic list (e.g., ≥10 topics).  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F5.2** Provide difficulty list (Easy/Medium/Hard).  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD

- [ ] **F6** Provide question details for the session.  
  Status: Not started | Priority: High | Milestone: D2 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F6.1** Show problem statement (optionally markdown preview; hints censored by default).  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F6.2** Provide starting coding template per question.  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

### Epic M4 — Collaboration Service
- [ ] **F7** Real-time collaborative code editor.  
  Status: Not started | Priority: High | Milestone: D3 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F7.1** Real-time concurrent editing with minimal delay.  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F7.2** Syntax highlighting.  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

- [ ] **F8** Communication between matched users (e.g., chat).  
  Status: Not started | Priority: Medium | Milestone: D3 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F8.1** In-session chat with minimal delay.  
    Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

### Epic M5 — Basic UI
- [ ] **F11** UI supports core flows (login, matching, collaboration).  
  Status: Not started | Priority: High | Milestone: D4 | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F11.2** Registration/login screens with validation errors.  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F11.3** Matching screen (topic/difficulty selection, status).  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD
  - [ ] **F11.4** Collaboration screen (code editor, chat, terminate session).  
    Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD

### Epic M6 — Local deployment
- [ ] **DPL1** Run core services locally using containers.  
  Status: Not started | Priority: High | Milestone: D3/D4 | Owner: @ | Due: YYYY-MM-DD

---

## 2. Non-functional requirements (NFR)

- [ ] **N1** Username/email/password constraints and secure storage.  
  Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD

- [ ] **N3** Matching timeout and user feedback (e.g., timeout in ~1 minute).  
  Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD

- [ ] **N9** Session security & isolation (only the two authenticated users can access a session).  
  Status: Not started | Priority: High | Owner: @ | Due: YYYY-MM-DD

---

## 3. Nice-to-haves (N2H)
- [ ] **N2H-1** Question attempt history (store attempts, timestamps, solutions; allow review).
  Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

- [ ] **N2H-2** Display number of active users waiting in queue across all topics and difficulties (Referenced in F3.4).
  Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

- [ ] **N2H-3** Enhanced communication tool - Chatbox within the collaboration session (Referenced in F8).
  Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

- [ ] **N2H-4** CI/CD pipeline (build/test/scan; optional deploy).
  Status: Not started | Priority: Medium | Owner: @ | Due: YYYY-MM-DD

## UI Mock-up

> Elements in the UI Mock-up might be subjected to future changes.

![Matching Page](docs/images/ui_mockup_1.png)

![Matching Queue](docs/images/ui_mockup_2.png)

![Collaboration Space 1](docs/images/ui_mockup_3.png)

![Collaboration Space 2](docs/images/ui_mockup_4.png)

![Collaboration Space 3](docs/images/ui_mockup_5.png)

---

## Change Log (Optional)

- 2026-02-23: Initial product backlog drafted from D1 phase.