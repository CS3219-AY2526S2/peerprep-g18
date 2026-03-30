# UML Diagrams (UML.md)

This document is the **living UML documentation** for PeerPrep.  
**Note:** All diagrams and flows here are **subject to change** as requirements/design decisions evolve and as implementation details solidify; treat this as our current best snapshot unless updated before finalizing the project.

---

## 1. Scope & context

PeerPrep is designed around a microservices approach with core services (e.g., User, Matching, Question, Collaboration) and a Front End orchestrating user flows. 
This UML.md is intended to capture the architecture and interaction diagrams that support the required features (must-haves M1–M6) and any selected nice-to-haves (e.g., question attempt history).

---

## 2. Diagram index (quick links)

- [2.1 System overview](#21-system-overview)
- [2.2 Key user workflows](#22-key-user-workflows)

---

## 2.1 System overview

### 2.1.1 Component diagram (target)
**Goal:** A high-level component diagram showing Front End + each microservice boundary and major dependencies, created for early planning during D1 phase.

![Current system overview](images/uml_1.png)
> The current diagram is **NOT** the C4 Component Diagram for the project, but a high-level system overview. We will look to replace this where appropriate during future updates.

---

## 2.2 Key user workflows

### 2.2.1 Regular user workflow (surface-level sequence)
This diagram should show the primary “happy path” from login → selecting topic/difficulty → matching → collaboration session start.

![Surface-level sequence: regular workflow](images/uml_2.png)

---

### 2.2.2 Collaboration flow — ticket acquisition and WebSocket connection

Sequence diagram showing how a user obtains a one-time ticket from the API Gateway and connects to the Collaboration Service via Socket.IO.

**Source:** [`plantUML/collab.puml`](plantUML/collab.puml)

Key points:
- Ticket validation is done in the collab service's Socket.IO middleware, not via nginx `auth_request`.
- Each namespace connection (`/editor`, `/chat`) requires its own ticket.

### 2.2.3 Match to collaboration — end-to-end flow

Sequence diagram showing the full flow from matching two users to establishing a collaborative coding session.

**Source:** [`plantUML/matchToCollab.puml`](plantUML/matchToCollab.puml)

Key points:
- Matching service publishes to Redis Pub/Sub; API Gateway subscribes via SSE.
- Leader election (`SETNX`) ensures only one session is created per match.
- `/editor` and `/chat` are separate Socket.IO namespaces, each requiring its own ticket.
- Yjs CRDT updates are persisted to Redis as base64; plaintext `finalCode` snapshot maintained separately.

### 2.2.4 Collaboration to History — session end & cleanup

Sequence diagram showing the session cleanup flow when both users disconnect.

**Source:** [`plantUML/collabToHistory.puml`](plantUML/collabToHistory.puml)

Key points:
- 30-second grace period after both users disconnect before cleanup triggers.
- Collab service notifies API Gateway, which reads session metadata and final code from Redis.
- API Gateway saves the session record to Firestore via History Service, then deletes all Redis keys.

---

## Change Log (Optional)

- 2026-02-23: Initial diagram drafted from D1 phase.
- 2026-03-20: Added collaboration flow diagrams (collab.puml, matchToCollab.puml, collabToHistory.puml). Updated matchToCollab.puml to reflect unified Collab Service and correct event names.