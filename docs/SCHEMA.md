# Database Schema (Planned; Subject to Change)

This document records our **current** database schema plan for selected PeerPrep microservices (and a Nice-to-have).  
**Important:** These schemas are **work-in-progress** and may change as we refine requirements/design and implement the system; they should not be treated as the final implementation unless updated again near final submission. 

---

## Conventions

- IDs are represented as `UUID` across services (subject to implementation constraints).  
- “Editable” indicates fields that can be modified through service APIs/admin tooling (as planned).  
- Cross-service references are described as “Foreign Key*” because strict foreign keys may not be enforceable across microservice databases; referential integrity may be maintained at the application level.
    - **Additional sidenote:** The possibility of a *"schema-per-service"* within a *shared database instance* could be viable, although it reduces re-usability across modules due to domain-level dependencies (Refer to **L5.2-Architecture.pdf** for more information).

---

## M1: User Service (Schema)

Planned table: `Users`

| Field | Type | Remarks |
|---|---|---|
| `UserID` | UUID | Primary Key (Incremental)* |
| `Username` | String | Editable (Unique) |
| `Email` | String | Editable (Unique) |
| `HashedPassword` | String | Editable (Hashed) |
| `Salt` | String | Generated |
| `AvatarID` | Integer | Editable |
| `Role` | String | Editable (Enum) |

Notes:
- `Username` and `Email` are intended to be unique identifiers for login/identity. 
- `Role` supports role-based access control (RBAC) at the User Service level (exact roles to be finalized). 

---

## M3: Question Management (Schema)

Planned table: `Questions`

| Field | Type | Remarks |
|---|---|---|
| `QuestionID` | UUID | Primary Key |
| `TopicTag` | String (e.g., "Array") | Editable (Enum) |
| `DifficultyTag` | String (e.g., "Easy") | Editable (Enum) |
| `Description` | String | Editable |
| `Hint` | String | Editable |
| `CodeTemplate` | String | Editable |

Notes:
- The Question Service is expected to support storing and retrieving questions by difficulty/topic, and provide question details during session initiation. 
- `Description`/`Hint` may later support markdown formatting and/or richer content depending on implementation. 

---

## N2: Question History (Schema) (Nice-to-have)

Planned table: `QuestionHistory` (or `SessionsHistory`)

| Field | Type | Remarks |
|---|---|---|
| `SessionID` | UUID | Primary Key (Unique) |
| `User1ID` | UUID | Foreign Key* (M1) |
| `User2ID` | UUID | Foreign Key* (M1) |
| `QuestionID` | UUID | Foreign Key* (M3) |
| `TimeStamp` | DateTime | Session time marker (exact semantics TBD) |
| `AttemptedCode` | String | Captured code attempt (format/storage TBD) |

Notes:
- This supports the Nice-to-have direction “question attempt history” (storing attempts + metadata so users can review later). 
- `AttemptedCode` storage may change (e.g., size limits, compression, versioning, or storing references to object storage) depending on collaboration/editor integration. 

---

## Change Log (Optional)

- 2026-02-23: Initial schema drafted from D1 planning screenshots.
