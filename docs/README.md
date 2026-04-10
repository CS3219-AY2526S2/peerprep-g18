# docs/ README

This `docs/` folder contains living documentation for our PeerPrep project (CS3219 AY2526S2).
**Important:** Most documents here are **work-in-progress** and **subject to change** as we iterate on requirements, design decisions, and implementation details; treat them as the latest snapshot unless updated again near final submission.

---

## Contents

- [`BACKLOG.md`](BACKLOG.md)
  Markdown-friendly product backlog that supports completion tracking via checkboxes and simple assignment metadata (Owner/Due/Done).
  This aligns with the milestone requirement to develop requirements in the form of a product backlog.

- [`API.md`](API.md)
  RESTful and WebSocket API documentation for all microservices: User Service, Question Service, Matching Service, Collaboration Service, History Service, and AI Service.

- [`UML.md`](UML.md)
  Central place to track and maintain our UML diagrams (component/sequence diagrams), including allocated space for our current surface-level sequence diagrams (Question History integration + overall user workflow).

- [`SCHEMA.md`](SCHEMA.md)
  Planned database table schemas for selected microservices / features (e.g., User Service, Question Management, Session History).
  Note: schemas may evolve as we finalize service boundaries and persistence decisions.

- [`plantUML/`](plantUML/)
  PlantUML source files for sequence diagrams:
  - `collab.puml` — Ticket acquisition and WebSocket connection flow
  - `matchToCollab.puml` — End-to-end flow from matching to collaboration (Polling handled by matching-service; session leader election by api-gateway)
  - `collabToHistory.puml` — Session end, history save, and Redis cleanup flow (collab-service triggers history-service directly)
  - `question-service-sequence.puml` — Question service interactions
  - `user-service-sequence.puml` — User service interactions

- [`ImplementationGuide/CollabImplementation.md`](ImplementationGuide/CollabImplementation.md)
  Phased implementation log for the collaboration service (Phases 0–7). Phase 7 documents the gateway cleanup migration (2026-03-30).

---

## Updating docs (team convention)

- Keep “subject to change” disclaimers in early-stage design documents (UML, schema drafts).
- When a design becomes implementation-backed, update the document status from Draft → Final (and note the commit/PR).
- Prefer editing via a branch + PR review to avoid untracked changes on `main`.
