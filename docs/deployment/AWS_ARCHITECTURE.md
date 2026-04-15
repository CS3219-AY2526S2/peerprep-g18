# PeerPrep AWS Deployment Architecture

> **Region:** `ap-southeast-1` (Singapore)  
> **IaC:** Terraform  
> **CI/CD:** GitHub Actions  
> **Deployed branch:** `main`

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Network Layer (VPC)](#2-network-layer-vpc)
3. [Frontend Delivery (S3 + CloudFront)](#3-frontend-delivery-s3--cloudfront)
4. [CloudFront Routing Rules](#4-cloudfront-routing-rules)
5. [API Layer (API Gateway + Lambda)](#5-api-layer-api-gateway--lambda)
6. [Stateful Services (ECS on EC2)](#6-stateful-services-ecs-on-ec2)
7. [Shared Infrastructure](#7-shared-infrastructure)
8. [CI/CD Pipeline](#8-cicd-pipeline)
9. [IAM & Security Summary](#9-iam--security-summary)
10. [Service Inventory](#10-service-inventory)

---

## 1. High-Level Overview

```
                          ┌──────────────────────────────────────────────────────────────┐
                          │                        INTERNET                              │
                          └───────────────────────────┬──────────────────────────────────┘
                                                      │ HTTPS
                                                      ▼
                          ┌───────────────────────────────────────────────────────────────┐
                          │                  AWS CloudFront (CDN)                         │
                          │           PriceClass_200 (Asia + Global Edge)                 │
                          │                                                               │
                          │  /socket.io/*  /editor/*  /chat/*  /collab/*  ──────────────► │──► ALB
                          │  /api/*  ────────────────────────────────────────────────────►│──► API Gateway (HTTP API)
                          │  /*  (default) ──────────────────────────────────────────────►│──► S3 (frontend assets)
                          └───────────────────────────────────────────────────────────────┘
                                    │ OAC (SigV4)           │ HTTPS           │ HTTP
                                    ▼                       ▼                 ▼
                          ┌─────────────────┐  ┌────────────────────┐  ┌─────────────┐
                          │   S3 Bucket     │  │  AWS API Gateway   │  │  ALB (HTTP) │
                          │ (frontend SPA)  │  │  (HTTP API v2)     │  │ (public SN) │
                          └─────────────────┘  └────────┬───────────┘  └──────┬──────┘
                                                        │                     │
                                    ┌───────────────────┘                     │
                                    ▼                              ┌──────────┴───────────┐
                          ┌──────────────────────┐     /matching/* │          /collab/*   │
                          │  Lambda: api-gateway │                 │                      │
                          │  (Node.js container) │                 ▼                      ▼
                          └──────────┬───────────┘     ┌──────────────────┐  ┌──────────────────────┐
                                     │                 │ ECS: matching-   │  │ ECS: collaboration-  │
                          ┌──────────┴────────────┐    │ service (8001)   │  │ service (3001)       │
                          │  Lambda function URLs │    │ SSE / long-poll  │  │ WebSockets (Yjs+chat)│
                          ├──────────────────────┬┘    └───────┬──────────┘  └──────────┬───────────┘
                          │  user-service  :8002 │             │                        │
                          │  question-svc  :8003 │             └────────────────────────┘
                          │  history-svc   :8004 │                          │
                          │  ai-service    :8005 │                          ▼
                          └──────────────────────┘              ┌─────────────────────────┐
                                     │                          │  ElastiCache Redis 7.0  │
                                     │                          │  (cache.t4g.micro)      │
                                     │                          │  Sessions · Queues ·    │
                                     └─────────────────────────►│  PubSub · Match State   │
                                                                └─────────────────────────┘
                                                                          │
                                                              ┌───────────┴────────────┐
                                                              │   Firestore (GCP)      │
                                                              │  Users · Questions ·   │
                                                              │  History               │
                                                              └────────────────────────┘
```

---

## 2. Network Layer (VPC)

```
VPC: peerprep-vpc  (10.0.0.0/16)   ap-southeast-1
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  ┌──── Public Subnets ──────────────────────────────────────────┐     │
│  │  ap-southeast-1a: 10.0.101.0/24  │  ap-southeast-1b: 10.0.102.0/24 │
│  │                                                              │     │
│  │   ┌─────────────────────────┐      ┌──────────────────────┐  │     │
│  │   │  Application Load       │      │   NAT Gateway (x1)   │  │     │
│  │   │  Balancer (peerprep-alb)│      │   (cost-saving mode) │  │     │
│  │   └─────────────────────────┘      └──────────────────────┘  │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                  │ NAT                                │
│  ┌──── Private Subnets ──────────▼──────────────────────────────┐     │
│  │  ap-southeast-1a: 10.0.1.0/24   │  ap-southeast-1b: 10.0.2.0/24    │
│  │                                                              │     │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐   │     │
│  │  │ ECS EC2 Nodes  │  │ Lambda functions│  │ ElastiCache  │   │     │
│  │  │ (t3.small ×2)  │  │ (in VPC)        │  │ Redis        │   │     │
│  │  └────────────────┘  └─────────────────┘  └──────────────┘   │     │
│  └──────────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────────┘
```

| Resource | Value |
|---|---|
| CIDR | `10.0.0.0/16` |
| Public subnets | `10.0.101.0/24`, `10.0.102.0/24` |
| Private subnets | `10.0.1.0/24`, `10.0.2.0/24` |
| NAT Gateway | Single (cost-saving; not HA) |
| Internet Gateway | 1 (attached to public subnets) |

---

## 3. Frontend Delivery (S3 + CloudFront)

```
GitHub Actions (push to frontend/**)
          │
          │  1. npm install && npm run build (Vite)
          │  2. aws s3 sync frontend/dist → S3
          │  3. CloudFront invalidation /*
          ▼
┌───────────────────────────────────┐
│  S3 Bucket                        │
│  peerprep-frontend-655738707953   │
│  ─ Public access: BLOCKED         │
│  ─ Encryption: AES-256            │
└──────────────────┬────────────────┘
                   │ OAC (Origin Access Control, SigV4)
                   │ CloudFront is the only allowed reader
                   ▼
┌──────────────────────────────────────────────────────┐
│  CloudFront Distribution                             │
│  ─ IPv6 enabled                                      │
│  ─ PriceClass_200 (Asia-Pacific + global edges)      │
│  ─ Default root: index.html                          │
│  ─ SPA fallback: 403/404 → /index.html               │
│  ─ Default cache: TTL 1h (max 24h)                   │
│  ─ HTTPS enforced (redirect-to-https on all paths)   │
└──────────────────────────────────────────────────────┘
```

---

## 4. CloudFront Routing Rules

CloudFront acts as the **single entry point** for all traffic — both frontend assets and backend API calls.

| Priority | Path Pattern | Origin | Cache Policy | Notes |
|---|---|---|---|---|
| 1 | `/socket.io/*` | ALB | Caching Disabled | WebSocket upgrade headers forwarded |
| 2 | `/editor/*` | ALB | Caching Disabled | Collaboration editor (Yjs) |
| 3 | `/chat/*` | ALB | Caching Disabled | Collaboration chat |
| 4 | `/collab/*` | ALB | Caching Disabled | Collaboration REST endpoints |
| 5 | `/api/*` | AWS API Gateway | Caching Disabled | All other API calls |
| Default | `/*` | S3 | TTL 1h / 24h max | React SPA static assets |

All non-default behaviors use `AllViewerExceptHostHeader` origin request policy to forward auth headers.

---

## 5. API Layer (API Gateway + Lambda)

```
CloudFront /api/*
      │
      ▼
┌──────────────────────────────────────┐
│  AWS API Gateway (HTTP API v2)       │
│  peerprep-api                        │
│  ─ CORS: CloudFront URL + localhost  │
│  ─ Stage: $default (auto-deploy)     │
│  ─ Route: $default → api-gateway λ   │
└──────────────────┬───────────────────┘
                   │ AWS_PROXY integration
                   ▼
┌──────────────────────────────────────┐
│  Lambda: peerprep-api-gateway        │
│  ─ Runtime: Container image (Node.js)│
│  ─ Memory: 512 MB  │  Timeout: 30s   │
│  ─ VPC: private subnets              │
│  ─ Auth validation, routing logic    │
└──────┬───────────────────────────────┘
       │ Calls internal services via Lambda Function URLs
       │
       ├──► peerprep-user-service      (port 8002, FastAPI/Mangum)
       ├──► peerprep-question-service  (port 8003, FastAPI/Mangum)
       ├──► peerprep-history-service   (port 8004, FastAPI/Mangum)
       ├──► peerprep-ai-service        (port 8005, FastAPI/Mangum)
       │
       ├──► http://ALB/matching/*      (ECS matching-service)
       └──► http://ALB/collab/*        (ECS collaboration-service)
```

### Lambda Function Configuration

| Function | Image Source | Memory | Timeout | VPC |
|---|---|---|---|---|
| `peerprep-api-gateway` | ECR `peerprep/api-gateway` | 512 MB | 30s | Yes |
| `peerprep-user-service` | ECR `peerprep/user-service` | 512 MB | 30s | Yes |
| `peerprep-question-service` | ECR `peerprep/question-service` | 512 MB | 30s | Yes |
| `peerprep-history-service` | ECR `peerprep/history-service` | 512 MB | 30s | Yes |
| `peerprep-ai-service` | ECR `peerprep/ai-service` | 512 MB | 30s | Yes |

All Lambdas run inside the VPC private subnets and share the `peerprep-lambda-sg` security group (egress-only — no inbound rules; triggered by API GW or function URLs).

---

## 6. Stateful Services (ECS on EC2)

Matching and Collaboration require **persistent connections** (SSE/WebSockets) that are unsuitable for Lambda's stateless model.

```
ALB (peerprep-alb)
│  ─ Internet-facing (public subnets)
│  ─ Listener: HTTP :80
│
├── Rule /matching/* ──► Target Group matching-tg  (port 8001)
│                         Health: GET /health
│
└── Rule /collab/*
    Rule /socket.io/* ──► Target Group collaboration-tg (port 3001)
                          Health: GET /collab/health

          │                              │
          ▼                              ▼
┌─────────────────────┐       ┌─────────────────────────┐
│  ECS Service:       │       │  ECS Service:           │
│  peerprep-matching  │       │  peerprep-collaboration │
│  ─ 1 task           │       │  ─ 1 task               │
│  ─ CPU: 256  Mem:512│       │  ─ CPU: 256  Mem: 512   │
└─────────┬───────────┘       └─────────────────────────┘
          │
          └──── both run on ────►
                    ┌───────────────────────────────────────┐
                    │  ECS Cluster: peerprep-cluster        │
                    │  ─ Container Insights: enabled        │
                    │  ─ Capacity Provider: peerprep-cp     │
                    │                                       │
                    │  Auto Scaling Group (peerprep-ecs-asg)│
                    │  ─ EC2 type: t3.small (x86_64)        │
                    │  ─ AMI: Amazon Linux 2 (ECS-optimized)│
                    │  ─ Min: 2  │  Max: 2  │  Desired: 2   │
                    │  ─ Placement: private subnets         │
                    │  ─ No public IP                       │
                    └───────────────────────────────────────┘
```

### Network Mode

ECS tasks use `awsvpc` network mode — each task gets its own ENI and IP. The ASG runs 2 nodes specifically to provide enough ENIs for all services across both AZs.

---

## 7. Shared Infrastructure

### ElastiCache Redis

```
┌──────────────────────────────────────────────────┐
│  ElastiCache Cluster: peerprep-redis             │
│  ─ Engine: Redis 7.0                             │
│  ─ Node type: cache.t4g.micro (1 node)           │
│  ─ Port: 6379                                    │
│  ─ Subnet group: private subnets                 │
│  ─ Security group: peerprep-redis-sg             │
│    (ingress only from VPC CIDR 10.0.0.0/16)      │
│                                                  │
│  Logical usage per service:                      │
│  ─ api-gateway    → session token invalidation   │
│  ─ matching       → match queue + state          │
│  ─ collaboration  → ticket-based auth + pub/sub  │
│  ─ user-service   → auth session cache           │
└──────────────────────────────────────────────────┘
```

### ECR (Elastic Container Registry)

One private repository per service, all under the `peerprep/` namespace:

| Repository | Used By |
|---|---|
| `peerprep/api-gateway` | Lambda (api-gateway) |
| `peerprep/user-service` | Lambda (user-service) |
| `peerprep/question-service` | Lambda (question-service) |
| `peerprep/history-service` | Lambda (history-service) |
| `peerprep/ai-service` | Lambda (ai-service) |
| `peerprep/matching-service` | ECS (matching-service) |
| `peerprep/collaboration-service` | ECS (collaboration-service) |

- **Scan on push:** enabled (vulnerability scanning)
- **Encryption:** AES-256
- **Lifecycle policy:** keep only last 3 images (cost control)

### Secrets Manager

| Secret Name | Contents | Used By |
|---|---|---|
| `peerprep/firebase-main` | Firebase service account JSON | api-gateway, user-service |
| `peerprep/firebase-history` | Firebase service account JSON | history-service |
| `peerprep/firebase-question` | Firebase service account JSON | question-service |
| `peerprep/backend-env` | SMTP credentials, API keys, etc. | all services |

### CloudWatch Logs

ECS services write logs to CloudWatch with 7-day retention:
- `/ecs/peerprep-matching-service`
- `/ecs/peerprep-collaboration-service`

Lambda functions write to their auto-created log groups via `AWSLambdaBasicExecutionRole`.

---

## 8. CI/CD Pipeline

Every service has a dedicated GitHub Actions workflow triggered on push to `main` for its respective path.

### Frontend Deploy

```
push to main (frontend/**)
        │
        ▼
  GitHub Actions Runner (ubuntu-latest)
        │
        ├─ 1. Setup Node 20
        ├─ 2. npm install && npm run build (Vite)
        │      VITE_GATEWAY_URL="/api"
        ├─ 3. aws s3 sync frontend/dist → s3://peerprep-frontend-{ACCOUNT_ID} --delete
        └─ 4. aws cloudfront create-invalidation --paths "/*"
```

### Lambda Service Deploy (api-gateway, user, question, history, ai)

```
push to main (backend/{service-name}/**)
        │
        ▼
  GitHub Actions Runner (ubuntu-latest)
        │
        ├─ 1. Configure AWS Credentials (OIDC / Access Key)
        ├─ 2. Login to ECR
        ├─ 3. docker build -t ECR/peerprep/{service}:latest
        │               -t ECR/peerprep/{service}:{git-sha}
        ├─ 4. docker push (both tags)
        └─ 5. aws lambda update-function-code
                --function-name peerprep-{service}
                --image-uri ECR/peerprep/{service}:{git-sha}
```

### ECS Service Deploy (matching, collaboration)

```
push to main (backend/{service-name}/**)
        │
        ▼
  GitHub Actions Runner (ubuntu-latest)
        │
        ├─ 1. Configure AWS Credentials
        ├─ 2. Login to ECR
        ├─ 3. docker build + push (latest + git-sha tags)
        ├─ 4. aws ecs describe-task-definition → task-definition.json
        ├─ 5. amazon-ecs-render-task-definition
        │      (inject new image URI into task def)
        └─ 6. amazon-ecs-deploy-task-definition
                --service peerprep-{service}
                --cluster peerprep-cluster
                --wait-for-service-stability true
```

### Workflow Matrix

| Workflow File | Trigger Path | Deploy Target |
|---|---|---|
| `deploy-frontend.yml` | `frontend/**` | S3 + CloudFront |
| `deploy-api-gateway.yml` | `backend/api-gateway/**` | Lambda |
| `deploy-user-service.yml` | `backend/user-service/**` | Lambda |
| `deploy-question-service.yml` | `backend/question-service/**` | Lambda |
| `deploy-history-service.yml` | `backend/history-service/**` | Lambda |
| `deploy-ai-service.yml` | `backend/ai-service/**` | Lambda |
| `deploy-matching-service.yml` | `backend/matching-service/**` | ECS |
| `deploy-collaboration-service.yml` | `backend/collaboration-service/**` | ECS |
| `ci.yml` | All branches | Tests / lint |

---

## 9. IAM & Security Summary

### IAM Roles

| Role | Attached To | Key Permissions |
|---|---|---|
| `peerprep-ecs-task-execution-role` | ECS tasks | ECR pull, CloudWatch logs, Secrets Manager read |
| `peerprep-ecs-instance-role` | EC2 ECS nodes | `AmazonEC2ContainerServiceforEC2Role` |
| `peerprep-lambda-exec-role` | All Lambda functions | VPC access, CloudWatch logs, ECR pull, Secrets Manager read |

### Security Groups

| SG Name | Attached To | Ingress | Egress |
|---|---|---|---|
| `peerprep-alb-sg` | ALB | :80 from `0.0.0.0/0` | All |
| `peerprep-ecs-node-sg` | ECS EC2 hosts | All ports from ALB SG only | All |
| `peerprep-lambda-sg` | Lambda functions | None (triggered externally) | All |
| `peerprep-redis-sg` | ElastiCache | :6379 from VPC CIDR only | All |

### Key Security Notes

- **S3** is fully private; CloudFront accesses it via Origin Access Control (SigV4 signed requests)
- **Lambdas** run inside the VPC; no public network interface
- **ECS nodes** have no public IPs; only reachable through ALB
- **Redis** is accessible only within the VPC CIDR (`10.0.0.0/16`)
- **Secrets Manager** secrets are scoped to explicit ARNs; no wildcard resource access

---

## 10. Service Inventory

| Service | Runtime | AWS Compute | Port | Connects To |
|---|---|---|---|---|
| Frontend | React + Vite | S3 + CloudFront | — | `/api/*`, `/collab/*`, `/socket.io/*` |
| api-gateway | Node.js (container) | Lambda | 8000 | All internal services |
| user-service | Python FastAPI + Mangum | Lambda | 8002 | Redis, Firestore, Secrets Manager |
| question-service | Python FastAPI + Mangum | Lambda | 8003 | Firestore, Secrets Manager |
| history-service | Python FastAPI + Mangum | Lambda | 8004 | Firestore, question-service URL, Secrets Manager |
| ai-service | Python FastAPI + Mangum | Lambda | 8005 | External LLM APIs |
| matching-service | Node.js | ECS (EC2) | 8001 | Redis, question-service URL, history-service URL |
| collaboration-service | Node.js | ECS (EC2) | 3001 | Redis, question-service URL, history-service URL, ai-service URL |
