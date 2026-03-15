# PeerPrep API Gateway (The Orchestrator)

The API Gateway is the central "brain" of the PeerPrep microservices architecture. It acts as the single entry point for the frontend, handling security, routing, and complex service orchestration that doesn't belong in any single domain service.

## Core Responsibilities

1.  **Centralized Authentication:** Verifies Firebase JWTs for all incoming requests. It injects `X-User-Id` and `X-User-Role` headers into requests before forwarding them to internal microservices, ensuring they remain "auth-blind" and lightweight.
2.  **Reverse Proxying:** Maps public routes to internal service addresses (e.g., `/api/users/*` -> `user-service:6767`).
3.  **Session Orchestration:** The most critical role. It "glues" the Matching Service and Question Service together to initialize collaborative sessions.
4.  **WebSocket Management:** Handles the initial handshake and authorization for real-time services (Editor and Chat).

## Distributed Orchestration (The "Leader/Follower" Pattern)

To maintain horizontal scalability, multiple instances of the API Gateway run simultaneously. When a match is found, we must ensure only **one** gateway initializes the session to prevent duplicate Question Service calls or conflicting session IDs.

### The Redis Atomic Race
We utilize Redis's single-threaded nature to perform an "Atomic Race" for session leadership:

1.  **Pub/Sub Listener:** All gateway instances listen to the `match_events` channel.
2.  **ID Generation:** Upon receiving a match event for `UserA` and `UserB`, every gateway generates its own unique `session_id`.
3.  **The SETNX Race:** Every gateway attempts to claim leadership for that specific pair:
    ```bash
    SET lock:match:UserA:UserB <my_generated_id> NX GET
    ```
4.  **Determining the Winner:**
    *   **Winner (Leader):** If the command returns `nil`, this gateway "won" the race. It proceeds to fetch a random question and initialize the session state in Redis.
    *   **Loser (Follower):** If the command returns an existing ID, this gateway becomes the follower. It uses the ID returned by Redis (the winner's ID) to notify its connected user.

## Redis State Management

The Gateway treats Redis as the "Source of Truth" for active sessions:
*   **`session:<id>:meta`**: Stores the participants, the selected question ID, and status.
*   **Locks**: Used for the leader election race described above (typically with a short TTL/Expiry to prevent deadlocks in case of a crash).

## Tech Stack
*   **FastAPI:** High-performance Python web framework.
*   **Redis:** Used for Pub/Sub (notifications) and Distributed Locking (orchestration).
*   **Firebase Admin SDK:** For JWT verification and custom claims (RBAC).
*   **HTTPX:** For asynchronous proxying to internal services.
