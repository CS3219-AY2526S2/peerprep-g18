# PeerPrep Infrastructure Analysis (AWS Architecture)

This document provides a detailed analysis of the recommended AWS services for each component of the PeerPrep platform, balancing performance, scalability, and cost-efficiency.

## Frontend

### Service: Amazon S3 + Amazon CloudFront
- **Rationale**: The frontend is a static React application built with Vite. Serving it via S3 (for storage) and CloudFront (for global delivery and HTTPS) is significantly more cost-effective than running a dedicated web server.
- **Benefits**:
  - **Scalability**: Handles high traffic without any infrastructure management.
  - **Performance**: Edge caching via CloudFront ensures low latency for users globally.
  - **Cost**: Near-zero cost when idle; pay-only-for-bandwidth/storage.

## Backend Microservices (Stateless / Event-driven)

### Question Service
- **Service**: **AWS Lambda** (FastAPI with Mangum)
- **Rationale**: Expected low usage and infrequent access patterns. Serverless execution minimizes billing when idle. Cold starts are acceptable here as question loading is a non-critical setup phase of a session.
- **Horizontal Scaling**: Lambda automatically scales out to handle peaks during user surges.

### User Service
- **Service**: **AWS Lambda** (FastAPI with Mangum)
- **Rationale**: Previously targeted for AWS App Runner, this service has been migrated to AWS Lambda due to the upcoming deprecation of App Runner in late April 2026. Lambda provides a cost-effective, serverless alternative that scales automatically. To mitigate cold starts for critical auth paths, provisioned concurrency can be utilized if necessary.
- **Fallback**: Provisioned concurrency if latency requirements are not met by standard Lambda.

### History Service
- **Service**: **AWS Lambda**
- **Rationale**: Similar to Question Service, it performs infrequent CRUD operations (saving at session end, retrieving for profile view). Serverless architecture is ideal for this asynchronous/bursty load.

### AI Service
- **Service**: **AWS Lambda**
- **Rationale**: Assuming it acts as an orchestration layer for external LLM APIs (like Gemini/Bedrock). Lambda's cost-per-execution model is perfect for on-demand AI features.

## Backend Microservices (Stateful / Long-running)

### Matching Service
- **Service**: **AWS ECS**
- **Rationale**: Matching logic involves long-polling or Server-Sent Events (SSE) to maintain a connection with the user while searching for a peer. It also uses background workers for queue processing. Lambda's 15-minute execution limit and stateless nature make it unsuitable for long-lived matching sessions.
- **Scaling**: Scales horizontally based on CPU/Memory or custom metrics like pending match count.

### Collaboration Service
- **Service**: **AWS ECS** (Behind an ALB with WebSockets)
- **Rationale**: Requires persistent WebSocket connections for real-time document sync (Yjs) and chat. ECS is better suited for stateful connections and provides better control over memory management for the Yjs document state.
- **Networking**: Application Load Balancer (ALB) supports the necessary sticky sessions (if needed) and WebSocket protocol.

## Data & Infrastructure

### Database (Stick with Firestore)
- **Service**: **Firestore** for multi-cloud

### Cache & Session State (Redis)
- **Service**: **Amazon ElastiCache for Redis OSS**
- **Rationale**: Provides a high-performance, fully managed Redis cluster for ephemeral state (matching queues, session tickets, chat history).
- **Benefits**: Offloads session management from the services and ensures low-latency state sharing between microservices.

### API Gateway / Routing
- **Service**: **Amazon API Gateway** + **AWS Lambda** (for the Gateway Microservice)
- **Rationale**: Amazon API Gateway handles the public entry point, CORS, and standard routing. The internal `api-gateway` logic (auth token validation, custom routing) should run as a containerized Lambda to handle request throughput efficiently and cost-effectively following the App Runner deprecation.

---

## Architecture Summary Table

| Component | AWS Service | Scaling Mode | Cost Profile |
|-----------|-------------|--------------|--------------|
| Frontend | S3 + CloudFront | Automatic | Very Low |
| Question Service | Lambda | Per-request | Zero-idle |
| User Service | Lambda | Per-request | Zero-idle |
| History Service | Lambda | Per-request | Zero-idle |
| AI Service | Lambda | Per-request | Zero-idle |
| Matching Service | ECS | Auto-scaling (Task) | Medium |
| Collaboration Service | ECS | Auto-scaling (Task) | Medium |
| API Gateway | API GW + Lambda | Managed/Per-request | Low-Medium |
| Primary Database | DynamoDB | On-demand / Provisioned | Scalable |
| Redis Cache | ElastiCache | Node-based | Fixed-per-node |
