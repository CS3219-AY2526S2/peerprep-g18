# docs/ README

This `docs/` folder contains living documentation for our PeerPrep project (CS3219 AY2526S2).
**Important:** Most documents here are **work-in-progress** and **subject to change** as we iterate on requirements, design decisions, and implementation details; treat them as the latest snapshot unless updated again near final submission.

---

## Contents

- [`BACKLOG.md`](docs/BACKLOG.md)
  Markdown-friendly product backlog that supports completion tracking via checkboxes and simple assignment metadata (Owner/Due/Done).  
  This aligns with the milestone requirement to develop requirements in the form of a product backlog.

- [`UML.md`](docs/UML.md)
  Central place to track and maintain our UML diagrams (component/sequence diagrams), including allocated space for our current surface-level sequence diagrams (Question History integration + overall user workflow).

- [`SCHEMA.md`](docs/SCHEMA.md)
  Planned database table schemas for selected microservices / features (e.g., User Service, Question Management, Question History).  
  Note: schemas may evolve as we finalize service boundaries and persistence decisions.

---

## Updating docs (team convention)

- Keep “subject to change” disclaimers in early-stage design documents (UML, schema drafts).
- When a design becomes implementation-backed, update the document status from Draft → Final (and note the commit/PR).
- Prefer editing via a branch + PR review to avoid untracked changes on `main`.
