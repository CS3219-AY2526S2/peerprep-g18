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
  Central place to track and maintain our UML diagrams (component/sequence diagrams). Includes actual diagram images for system architecture, API Gateway, User Service, Question Service, and various user workflows.

- [`SCHEMA.md`](SCHEMA.md)
  Planned database table schemas for selected microservices / features (e.g., User Service, Question Management, Session History).
  Note: schemas may evolve as we finalize service boundaries and persistence decisions.

- [`TESTING_GUIDE.md`](TESTING_GUIDE.md)
  Documentation for running tests locally and in CI, including coverage and integration testing details.

- [`deployment/`](deployment/)
  Contains comprehensive documentation and scripts for AWS deployment:
  - `AWS_ARCHITECTURE.md` — Deep dive into the AWS ECS/ALB architecture.
  - `AWS_DEPLOYMENT_GUIDE.md` — Step-by-step instructions for deploying to AWS.
  - `DEPLOYMENT_PLAN.md` — Phased rollout and rollback strategies.
  - `scripts/` — Bootstrap scripts for ECR and other infrastructure components.

- [`plantUML/`](plantUML/)
  PlantUML source files for sequence diagrams:
  - `api-gateway-sequence.puml` — Auth and proxying flow.
  - `user-service-sequence.puml` — User registration and management flow.
  - `question-service-sequence.puml` — Question bank CRUD flow.
  - `collab.puml` — Ticket acquisition and WebSocket connection flow.
  - `matchToCollab.puml` — End-to-end flow from matching to collaboration.
  - `collabToHistory.puml` — Session end, history save, and Redis cleanup flow.

---

## Updating docs (team convention)

- Keep “subject to change” disclaimers in early-stage design documents (UML, schema drafts).
- When a design becomes implementation-backed, update the document status from Draft → Final (and note the commit/PR).
- Prefer editing via a branch + PR review to avoid untracked changes on `main`.
