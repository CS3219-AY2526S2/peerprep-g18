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

## Change Log (Optional)

- 2026-02-23: Initial diagram drafted from D1 phase.