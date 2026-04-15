# Understanding AWS: A PeerPrep Deployment Guide

> This guide is written to help you **understand** AWS — not just follow commands.
> Every AWS service we use is explained from first principles, then tied directly back to how PeerPrep uses it.

---

## Table of Contents

1. [The Big Picture — Why AWS?](#1-the-big-picture--why-aws)
2. [IAM — Who Are You on AWS?](#2-iam--who-are-you-on-aws)
3. [VPC — Your Private Network in the Cloud](#3-vpc--your-private-network-in-the-cloud)
4. [S3 — Object Storage (Your File Cabinet)](#4-s3--object-storage-your-file-cabinet)
5. [CloudFront — The Global Content Delivery Network](#5-cloudfront--the-global-content-delivery-network)
6. [ECR — Your Docker Image Registry](#6-ecr--your-docker-image-registry)
7. [Lambda — Serverless Functions](#7-lambda--serverless-functions)
8. [API Gateway — The Public Door to Lambda](#8-api-gateway--the-public-door-to-lambda)
9. [ECS — Running Containers Long-Term](#9-ecs--running-containers-long-term)
10. [ALB — The Traffic Director](#10-alb--the-traffic-director)
11. [ElastiCache (Redis) — Shared Memory](#11-elasticache-redis--shared-memory)
12. [Secrets Manager — Safe for Credentials](#12-secrets-manager--safe-for-credentials)
13. [CloudWatch — Logs and Monitoring](#13-cloudwatch--logs-and-monitoring)
14. [Terraform — Infrastructure as Code](#14-terraform--infrastructure-as-code)
15. [GitHub Actions — Automated Deployment](#15-github-actions--automated-deployment)
16. [How It All Fits Together — End-to-End Request Walk](#16-how-it-all-fits-together--end-to-end-request-walk)
17. [Manual Deployment Steps (What Terraform Cannot Do)](#17-manual-deployment-steps-what-terraform-cannot-do)

---

## 1. The Big Picture — Why AWS?

When you run your app on your laptop, it's just a process on your machine. When you deploy to AWS, you're renting computing resources from Amazon's global data centres and assembling them into a system.

AWS is not one product — it's a collection of **over 200 services**. Each service does one job well, and you wire them together. PeerPrep uses about 10 of these services.

Here is which part of PeerPrep maps to which AWS service:

```
What We Need                      AWS Service We Use
─────────────────────────────     ──────────────────────────────────────
Serve the React frontend          S3 (store files) + CloudFront (deliver fast)
Route requests from the browser   CloudFront (path-based routing)
Run our API Gateway microservice  Lambda + API Gateway
Run user/question/history/ai svc  Lambda (serverless containers)
Run matching service              ECS (long-running EC2 containers)
Run collaboration service         ECS (WebSockets need persistent container)
Store Docker images               ECR (Elastic Container Registry)
Shared session/queue cache        ElastiCache Redis
Store secrets (Firebase JSON...)  Secrets Manager
Private network for everything    VPC (Virtual Private Cloud)
Centralize logs                   CloudWatch Logs
Deploy automatically on git push  GitHub Actions CI/CD
```

---

## 2. IAM — Who Are You on AWS?

### What is IAM?

**IAM (Identity and Access Management)** is the security foundation of AWS. Before any resource can do anything, AWS asks: *"Who is making this request, and are they allowed to do it?"*

IAM answers both questions.

There are two main concepts:

| Concept | What it is | Real-world analogy |
|---|---|---|
| **User** | A person (or script) with a login | An employee with a key card |
| **Role** | A set of permissions that a service can temporarily assume | A job title that grants access to certain rooms |

### Why Roles, Not Users, for Services?

You never give your ECS containers or Lambda functions a hardcoded username/password. Instead, you assign them a **Role**. AWS automatically provides temporary credentials to any resource with a role — and rotates them constantly.

### PeerPrep's IAM Roles

**`peerprep-ecs-task-execution-role`** — Worn by ECS tasks when they start up.
- Allows ECS to pull your Docker image from ECR
- Allows ECS to write logs to CloudWatch
- Allows ECS to read secrets from Secrets Manager

**`peerprep-ecs-instance-role`** — Worn by the underlying EC2 virtual machines that host ECS.
- Allows the EC2 machine to register itself with the ECS cluster
- Allows ECS to manage containers on the machine

**`peerprep-lambda-exec-role`** — Worn by all Lambda functions.
- Allows Lambda to create CloudWatch log streams
- Allows Lambda to run inside the VPC
- Allows Lambda to pull its container image from ECR
- Allows Lambda to read secrets from Secrets Manager

### IAM Policies

A **Policy** is a JSON document that says "allow action X on resource Y". Roles are made of policies.

```
Role: peerprep-lambda-exec-role
  └── Policy: AWSLambdaVPCAccessExecutionRole   (AWS managed — lets Lambda join VPC)
  └── Policy: AWSLambdaBasicExecutionRole        (AWS managed — lets Lambda write to CloudWatch)
  └── Policy: peerprep-lambda-ecr-read           (Custom — lets Lambda pull from ECR)
  └── Policy: PeerPrepSecretsReadPolicy          (Custom — lets Lambda read our specific secrets)
```

### How to Deploy: GitHub Actions Credentials

For GitHub Actions to push Docker images and update Lambda/ECS, it needs AWS credentials. These are stored as **GitHub Secrets** (not AWS Secrets Manager):

| GitHub Secret | What it is |
|---|---|
| `AWS_ACCESS_KEY_ID` | The username of an IAM User |
| `AWS_SECRET_ACCESS_KEY` | The password of that IAM User |
| `AWS_REGION` | `ap-southeast-1` |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account number |
| `CLOUDFRONT_DISTRIBUTION_ID` | Used to invalidate the CDN cache after frontend deploy |

---

## 3. VPC — Your Private Network in the Cloud

### What is a VPC?

Imagine AWS as a giant shared office building. A **VPC (Virtual Private Cloud)** is your company's floor in that building — completely walled off from everyone else. You control who can enter, who can leave, and which rooms can talk to each other.

Without a VPC, all your services would be directly exposed to the public internet. With a VPC, they're hidden behind walls, and only specific, controlled doors exist.

### Subnets — Dividing the Floor

A **subnet** is a section of your VPC. PeerPrep divides its VPC into two types:

```
VPC: 10.0.0.0/16  (the whole floor)
│
├── Public Subnets (the reception area — internet can reach these)
│   ├── 10.0.101.0/24  in ap-southeast-1a
│   └── 10.0.102.0/24  in ap-southeast-1b
│
└── Private Subnets (the back office — internet CANNOT reach these)
    ├── 10.0.1.0/24    in ap-southeast-1a
    └── 10.0.2.0/24    in ap-southeast-1b
```

The CIDR notation (`10.0.0.0/16`) just means a range of IP addresses. `/16` gives you 65,536 private IPs to assign to resources inside your VPC.

**Why two of each?** AWS has multiple **Availability Zones (AZs)** — physically separate data centres within one region. Spreading resources across two AZs means if one data centre has a problem, your other AZ keeps running.

### Internet Gateway vs NAT Gateway

Two "doors" control traffic in and out of the VPC:

| Gateway | Direction | Used by | Cost |
|---|---|---|---|
| **Internet Gateway** | Bidirectional (in + out) | Public subnets (ALB) | Free |
| **NAT Gateway** | Outbound only | Private subnets | ~$32/month |

The **NAT Gateway** is the key to understanding why private subnets are safe:
- Your Lambda function (in a private subnet) can call out to Firestore on Google Cloud — the request goes out through the NAT Gateway
- But someone on the internet cannot reach your Lambda directly — there is no inbound path

### Security Groups — Per-Resource Firewalls

A **Security Group** is a virtual firewall attached directly to a resource (not to a subnet). Think of it as the lock on each individual room's door.

PeerPrep's security groups:

```
peerprep-alb-sg (on the Load Balancer)
  Inbound:  port 80  from anywhere (0.0.0.0/0)   ← users hit this
  Outbound: all traffic

peerprep-ecs-node-sg (on EC2 hosts running ECS)
  Inbound:  all ports BUT only from peerprep-alb-sg  ← only ALB can talk to ECS
  Outbound: all traffic

peerprep-lambda-sg (on Lambda functions)
  Inbound:  nothing  ← Lambda is triggered by API Gateway, not direct traffic
  Outbound: all traffic

peerprep-redis-sg (on Redis)
  Inbound:  port 6379  from VPC CIDR (10.0.0.0/16) only ← nothing outside VPC can touch Redis
  Outbound: all traffic
```

This is called **Defence in Depth** — even if an attacker somehow got through CloudFront and API Gateway, they still couldn't reach Redis because the security group blocks them.

---

## 4. S3 — Object Storage (Your File Cabinet)

### What is S3?

**S3 (Simple Storage Service)** is a file storage service. You put files in, you get files out. It doesn't run code — it just stores bytes.

Every file (called an **object**) lives inside a **bucket**. A bucket name must be globally unique across all of AWS (across everyone's accounts), which is why ours is `peerprep-frontend-655738707953` — the account ID is appended to guarantee uniqueness.

### How PeerPrep Uses S3

The React frontend is a **Static Single-Page Application (SPA)**. After `npm run build`, Vite produces a `dist/` folder of plain `.html`, `.js`, and `.css` files. These files don't need a Node.js server — any web server (or S3) can serve them.

```
npm run build
│
└── dist/
    ├── index.html         ← the SPA shell
    ├── assets/
    │   ├── index-Abc123.js   ← bundled JavaScript
    │   └── index-Def456.css  ← bundled CSS
    └── ...
```

GitHub Actions uploads (syncs) this `dist/` folder to S3 every time the frontend code changes.

### Why is S3 Blocked from the Public?

Even though S3 *can* serve files publicly, we block all direct public access. This forces all traffic through CloudFront instead. Why?

1. **HTTPS enforcement** — S3 HTTP URLs are not HTTPS by default; CloudFront handles SSL termination
2. **Caching** — CloudFront caches files at edge locations globally; S3 doesn't
3. **Cost** — Data transfer through CloudFront is cheaper than direct S3 egress
4. **Security** — You can enforce signed URLs, WAF rules, and geo-restrictions through CloudFront

### Bucket Policy — Only CloudFront Can Read

S3 uses a **Bucket Policy** (a JSON IAM policy on the bucket itself) to allow only our specific CloudFront distribution to read objects:

```
Allow: s3:GetObject
Principal: cloudfront.amazonaws.com
Condition: AWS:SourceArn == our-cloudfront-distribution-arn
```

This is called **Origin Access Control (OAC)** — CloudFront signs every request to S3 with SigV4, proving it's authorised.

### How to Deploy the Frontend

```
1. GitHub Actions builds:
   cd frontend && npm install && npm run build

2. Syncs to S3 (--delete removes files that no longer exist):
   aws s3 sync frontend/dist s3://peerprep-frontend-{ACCOUNT_ID} --delete

3. Invalidates CloudFront cache (so users see the new version):
   aws cloudfront create-invalidation --distribution-id {ID} --paths "/*"
```

Step 3 is important — without it, users would see the old cached version for up to 24 hours.

---

## 5. CloudFront — The Global Content Delivery Network

### What is CloudFront?

A **CDN (Content Delivery Network)** works by keeping copies of your files in many locations around the world, called **edge locations**. When a user requests a file, they get it from the nearest edge location instead of from your origin server in Singapore.

CloudFront has 400+ edge locations globally. A user in London fetching the PeerPrep homepage would get the HTML/JS from a London edge location, not from Singapore — making it many times faster.

### CloudFront as an API Router

Beyond caching, PeerPrep uses CloudFront as the **single entry point** for all traffic — both the frontend and all API calls. This means the browser only ever talks to one domain (the CloudFront URL), and CloudFront decides where to forward each request.

### The Three Origins

CloudFront is configured with three origins:

```
Origin 1: S3 Bucket                 (peerprep-frontend-... .s3.amazonaws.com)
Origin 2: ALB                       (peerprep-alb-....ap-southeast-1.elb.amazonaws.com)
Origin 3: AWS API Gateway           (tsesok37w7.execute-api.ap-southeast-1.amazonaws.com)
```

### Path-Based Routing (Cache Behaviours)

CloudFront inspects the URL path and forwards the request to the right origin:

```
Request URL                    Goes to          Why
─────────────────────────────  ───────────────  ───────────────────────────────────────
/socket.io/...                 ALB              WebSocket upgrade (needs persistent conn)
/editor/...                    ALB              Collaboration editor (Yjs, WebSocket)
/chat/...                      ALB              Collaboration chat (WebSocket)
/collab/...                    ALB              Collaboration REST endpoints
/api/...                       API Gateway      All normal API calls
/ (anything else)              S3               The React SPA (HTML, JS, CSS)
```

### SPA Routing Fix

React Router handles navigation client-side. But if a user directly visits `https://peerprep.com/dashboard`, S3 has no file at `/dashboard/index.html` — it would return a 403 or 404.

CloudFront is configured to intercept 403 and 404 errors from S3 and serve `/index.html` instead (with HTTP 200). React then handles the route from there.

```
User visits /dashboard
  → CloudFront asks S3 for /dashboard
  → S3 returns 403 (no such object)
  → CloudFront catches the 403
  → CloudFront returns /index.html (200)
  → React Router reads /dashboard from the URL
  → React renders the Dashboard component
```

### Caching Policy

For the React SPA assets, CloudFront uses a 1-hour default TTL (up to 24 hours max). This means:
- After a deploy, run the CloudFront invalidation to purge the cache
- Without an invalidation, users would see the old version for up to 24 hours

API calls (`/api/*`, `/collab/*`, etc.) use the `CachingDisabled` managed policy — these requests always reach the origin, never a cached copy.

---

## 6. ECR — Your Docker Image Registry

### What is ECR?

**ECR (Elastic Container Registry)** is AWS's private Docker image registry. It's the same concept as Docker Hub, but private and tightly integrated with the rest of AWS.

Think of it as a warehouse for your Docker images. When ECS needs to start a container or Lambda needs to run a function, they pull the image from ECR.

### Why Not Docker Hub?

1. **Private by default** — your service code never leaves AWS
2. **IAM integration** — access controlled by the same IAM roles as everything else
3. **No rate limits** — Docker Hub throttles pulls on free accounts; ECR doesn't
4. **Lower latency** — pulling from ECR within the same AWS region is much faster

### PeerPrep's Repositories

Each microservice has its own repository:

```
ECR Registry: {account-id}.dkr.ecr.ap-southeast-1.amazonaws.com
│
├── peerprep/api-gateway
├── peerprep/user-service
├── peerprep/question-service
├── peerprep/history-service
├── peerprep/ai-service
├── peerprep/matching-service
└── peerprep/collaboration-service
```

### Image Tags

Every deploy pushes two tags:
- `:latest` — always points to the most recent build
- `:{git-sha}` — a permanent snapshot (e.g., `:a3f9b12`) tied to the exact commit

ECS services and Lambda functions are updated to the specific `:git-sha` tag, not `:latest`. This means if something breaks, you can roll back by pointing the service to an older tag.

### Lifecycle Policy (Cost Control)

ECR charges for image storage. We configure a lifecycle policy to automatically delete old images, keeping only the 3 most recent per repository. This prevents storage costs from accumulating over time.

### How to Authenticate and Push

```bash
# 1. Get a temporary login token (valid 12 hours)
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin {account}.dkr.ecr.ap-southeast-1.amazonaws.com

# 2. Build your image
docker build -t peerprep/api-gateway:latest ./backend/api-gateway

# 3. Tag it with the ECR URL
docker tag peerprep/api-gateway:latest \
  {account}.dkr.ecr.ap-southeast-1.amazonaws.com/peerprep/api-gateway:latest

# 4. Push
docker push {account}.dkr.ecr.ap-southeast-1.amazonaws.com/peerprep/api-gateway:latest
```

GitHub Actions handles all of this automatically using the `aws-actions/amazon-ecr-login` action.

---

## 7. Lambda — Serverless Functions

### What is Lambda?

**Lambda** is AWS's serverless compute service. You upload code (or a Docker image), Lambda runs it when triggered, and you pay only for the actual milliseconds of compute time used.

The key characteristic: **there is no server to manage**. AWS allocates a fresh execution environment, runs your function, and discards the environment when done.

### How Lambda Works

```
Trigger arrives (e.g., API Gateway receives HTTP request)
          │
          ▼
AWS allocates a micro-VM ("execution environment")
          │
          ▼
Lambda pulls your container image from ECR (if not cached)
          │
          ▼
Your code runs, processes the request, returns a response
          │
          ▼
AWS keeps the environment warm for a few minutes (hoping for reuse)
          │ (if no traffic)
          ▼
Environment is discarded — zero cost
```

### Cold Starts vs Warm Starts

**Cold start:** The first invocation (or after idle time) — AWS has to spin up a new environment. This takes extra time (typically 500ms–2s for container images).

**Warm start:** A subsequent invocation while the environment is still alive — your code runs almost immediately.

For PeerPrep's use case (question loading, user auth, history), occasional cold starts are acceptable. The services aren't on latency-critical paths.

### Container-Based Lambdas

PeerPrep's Lambda functions are **container images**, not ZIP files. This means:
- Your service is packaged as a Dockerfile (same as a normal microservice)
- The image is pushed to ECR
- Lambda pulls and runs it

This approach makes local development and deployment identical — the same Docker container runs on your laptop and in Lambda.

### The Mangum Adapter (Python services)

Python services (user, question, history, ai) are built with **FastAPI**. FastAPI normally needs a running HTTP server (like uvicorn). But Lambda doesn't run a server — it invokes a handler function.

**Mangum** is an adapter that wraps a FastAPI app so it can receive Lambda events:

```python
# Normal FastAPI app
app = FastAPI()

@app.get("/users/{id}")
def get_user(id: str):
    return {"id": id}

# Wrap it for Lambda
from mangum import Mangum
handler = Mangum(app)   # Lambda calls handler(event, context)
```

The same FastAPI code runs identically on a local uvicorn server and inside Lambda — Mangum handles the translation.

### Lambda Environment Variables

Each Lambda function is given environment variables at deploy time, injected by Terraform:

```
REDIS_SESSIONS_HOST   → ElastiCache endpoint
REDIS_AUTH_HOST       → ElastiCache endpoint
FRONTEND_URL          → CloudFront HTTPS URL (for CORS)
USER_SERVICE_URL      → Lambda function URL of user-service
QUESTION_SERVICE_URL  → Lambda function URL of question-service
HISTORY_SERVICE_URL   → Lambda function URL of history-service
AI_SERVICE_URL        → Lambda function URL of ai-service
MATCHING_SERVICE_URL  → http://ALB-DNS
COLLAB_SERVICE_URL    → http://ALB-DNS
```

### Lambda Function URLs

Each internal service has a **Function URL** — a direct HTTPS endpoint that triggers the Lambda without going through API Gateway:

```
https://{id}.lambda-url.ap-southeast-1.on.aws/
```

These are used for **service-to-service communication** (e.g., the api-gateway Lambda calling the user-service Lambda directly, without the overhead of HTTP API Gateway).

### How to Deploy a Lambda Service

```bash
# 1. Build the Docker image
docker build -t {ecr-url}/peerprep/user-service:{sha} ./backend/user-service

# 2. Push to ECR
docker push {ecr-url}/peerprep/user-service:{sha}

# 3. Update the Lambda function to use the new image
aws lambda update-function-code \
  --function-name peerprep-user-service \
  --image-uri {ecr-url}/peerprep/user-service:{sha}
```

That's it. Lambda immediately starts using the new image on the next invocation. No restarts, no service interruptions.

---

## 8. API Gateway — The Public Door to Lambda

### What is API Gateway?

**API Gateway** is a managed service that gives your Lambda functions a proper public HTTP(S) endpoint with features like:
- CORS handling
- Request throttling and rate limiting
- Auth integration
- URL path routing

Without API Gateway, you'd have to expose raw Lambda function URLs directly — which works, but lacks routing control and CORS management.

### HTTP API vs REST API

AWS has two types: **HTTP API (v2)** and **REST API (v1)**. PeerPrep uses **HTTP API** — it's simpler, cheaper, and faster for proxy use cases.

### How PeerPrep's API Gateway Works

```
Browser → CloudFront /api/* → API Gateway (peerprep-api)
                                    │
                                    │  Route: $default (catch-all)
                                    │  Integration: AWS_PROXY → Lambda
                                    ▼
                           Lambda: peerprep-api-gateway
                                    │
                                    │  (parses path, validates JWT, forwards)
                                    ▼
                           Internal Lambda service
                           (user / question / history / ai)
```

The API Gateway has a single `$default` route that forwards **everything** to the `peerprep-api-gateway` Lambda. The gateway Lambda itself then inspects the path and decides which internal service to call.

This pattern (a Lambda that acts as an API gateway) means all auth logic, token validation, and routing logic lives in one place.

### CORS Configuration

**CORS (Cross-Origin Resource Sharing)** is a browser security feature. When your React app (on the CloudFront domain) makes a fetch request to the API Gateway domain, the browser checks if the API allows it.

API Gateway is configured to allow:
- Origin: CloudFront URL (`https://xxxx.cloudfront.net`) and `http://localhost:5173` (for local dev)
- Methods: all (`*`)
- Headers: `content-type`, `authorization`, `x-amz-date`, etc.

### Stage and Auto-Deploy

The API Gateway uses a `$default` stage with **auto-deploy enabled**. This means every change to the API configuration is immediately deployed — no manual "deploy API" step needed.

---

## 9. ECS — Running Containers Long-Term

### Why Not Lambda for Everything?

Lambda is perfect for short, stateless tasks. But two of PeerPrep's services have requirements that Lambda can't meet:

**Matching Service**
- Uses **Server-Sent Events (SSE)** to stream match updates to the browser
- Maintains an active connection for the entire duration of a match search (could be minutes)
- Lambda has a 15-minute max timeout and kills connections when done

**Collaboration Service**
- Uses **WebSockets** — a persistent, bidirectional TCP connection
- A WebSocket connection to a user must stay alive for the entire coding session (could be hours)
- Lambda cannot hold a WebSocket connection open across invocations

For these, we need a **long-running process** — something that stays running 24/7, like a traditional server.

### What is ECS?

**ECS (Elastic Container Service)** runs Docker containers on a cluster of virtual machines. Unlike Lambda, ECS containers:
- Run continuously (not triggered by events)
- Hold open connections (WebSockets, SSE, etc.)
- Have predictable CPU/memory allocation
- Are always warm — no cold starts

### ECS Concepts

```
ECS Cluster (peerprep-cluster)
│  A logical grouping — the "namespace" for your services
│
├── Capacity Provider (peerprep-capacity-provider)
│   │  Connects the cluster to actual EC2 machines via an ASG
│   │
│   └── Auto Scaling Group (peerprep-ecs-asg)
│       │  The pool of EC2 virtual machines
│       │
│       └── EC2 Instances (t3.small ×2)
│           │  The actual virtual machines running your containers
│           │  AMI: Amazon Linux 2 ECS-optimized (has Docker + ECS agent pre-installed)
│
├── Task Definition (peerprep-matching-service)
│   │  A blueprint: which image to use, how much CPU/RAM, env vars, ports, logging
│   │
│   └── ECS Service (peerprep-matching-service)
│       │  "Keep 1 task of this definition always running"
│       └── Task (the actual running container)
│
└── Task Definition (peerprep-collaboration-service)
    └── ECS Service (peerprep-collaboration-service)
        └── Task (the actual running container)
```

### Why 2 EC2 Nodes?

ECS uses **awsvpc** network mode — each task (container) gets its own Elastic Network Interface (ENI). An ENI is like a dedicated virtual network card for the container.

A `t3.small` instance supports a limited number of ENIs (about 4). By running 2 EC2 nodes across 2 AZs, we have enough ENIs to run both services with room to spare — and we get basic redundancy across Availability Zones.

### Task Definition — The Container Blueprint

The Task Definition specifies everything about how a container should run:

```json
{
  "family": "peerprep-matching-service",
  "networkMode": "awsvpc",
  "cpu": "256",          // 0.25 vCPU
  "memory": "512",       // 512 MB RAM
  "image": "{ecr-url}/peerprep/matching-service:latest",
  "portMappings": [{ "containerPort": 8001 }],
  "environment": [
    { "name": "REDIS_HOST", "value": "peerprep-redis.xxx.cache.amazonaws.com" },
    { "name": "PORT", "value": "8001" }
    // ... more env vars
  ],
  "logConfiguration": {
    "logDriver": "awslogs",
    "options": {
      "awslogs-group": "/ecs/peerprep-matching-service",
      "awslogs-region": "ap-southeast-1"
    }
  }
}
```

### ECS Service — Keeps Tasks Running

An **ECS Service** is a controller that says: "I want exactly 1 running task of this definition at all times." If the container crashes, ECS starts a new one automatically.

The service is also attached to the ALB's target group — so when a new task starts, ECS registers its IP address with the load balancer automatically.

### How to Deploy an ECS Service (CI/CD Steps)

Deploying to ECS is slightly more involved than Lambda because you need to update the Task Definition with the new image:

```bash
# 1. Build and push image to ECR (same as Lambda)
docker build -t {ecr-url}/peerprep/matching-service:{sha} ./backend/matching-service
docker push {ecr-url}/peerprep/matching-service:{sha}

# 2. Download the current task definition
aws ecs describe-task-definition \
  --task-definition peerprep-matching-service \
  --query taskDefinition > task-definition.json

# 3. Update the image field in the task definition JSON
#    (GitHub Actions: amazon-ecs-render-task-definition action does this)

# 4. Register the updated task definition (creates a new revision)
#    and trigger a rolling deployment on the ECS service
aws ecs deploy \
  --cluster peerprep-cluster \
  --service peerprep-matching-service \
  --task-definition task-definition.json
```

ECS performs a **rolling deployment** — it starts a new task with the new image, waits for it to pass health checks, then drains and stops the old task. Zero downtime.

---

## 10. ALB — The Traffic Director

### What is an ALB?

An **ALB (Application Load Balancer)** is a managed Layer 7 (HTTP) load balancer. "Layer 7" means it understands HTTP — it can inspect the URL path, method, and headers to make routing decisions.

It sits in the **public subnets** with a public IP, so it's reachable from the internet (via CloudFront). ECS containers sit in **private subnets** with no public IPs — they're only reachable through the ALB.

### ALB's Job in PeerPrep

```
CloudFront → ALB (HTTP :80)
                  │
                  ├── Rule 1: path /matching/*  → Target Group: matching-tg
                  │                                  └── ECS matching-service task (IP:8001)
                  │
                  └── Rule 2: path /collab/* or /socket.io/*
                                                 → Target Group: collaboration-tg
                                                     └── ECS collaboration-service task (IP:3001)
```

### Target Groups

A **Target Group** is a pool of destinations that the ALB can forward requests to. For ECS with `awsvpc` mode, targets are IP addresses.

When an ECS task starts, it registers its private IP with the target group. When it stops, it deregisters. The ALB automatically routes to healthy targets.

Each target group has a **health check** configured:
- Matching: `GET /health` every 30 seconds
- Collaboration: `GET /collab/health` every 30 seconds

If a container stops responding to health checks, ALB marks it unhealthy and stops sending it traffic.

### WebSocket Support

The ALB fully supports WebSocket connections. When the browser sends an HTTP `Upgrade: websocket` header, the ALB passes it through to the collaboration service, which upgrades the connection. The persistent WebSocket connection is then maintained directly between the browser and the ECS container (via the ALB as a transparent proxy).

---

## 11. ElastiCache (Redis) — Shared Memory

### What is Redis?

**Redis** is an in-memory data store. It holds data in RAM (not on disk), making it extremely fast — microsecond read/write times.

Redis is used for data that:
- Needs to be shared across multiple running instances
- Is ephemeral (okay to lose if the server restarts)
- Needs to be read/written very frequently

### What is ElastiCache?

Running Redis yourself means managing a server, updates, backups, and failover. **ElastiCache** is AWS's managed Redis service — AWS handles all of that. You just get a Redis endpoint to connect to.

### Why PeerPrep Needs Redis

Three different services need to share state:

**API Gateway Lambda → Redis**
- Stores JWT session tokens for validation
- When a user logs out, their token is added to a Redis blacklist
- All API Gateway instances check Redis on every request

**Matching Service → Redis**
- The match queue (users waiting to be paired) lives in Redis
- Match state (who is matched with whom, what question they're on)
- Uses Redis pub/sub to broadcast match events to waiting users

**Collaboration Service → Redis**
- Ticket-based auth: when a match is created, a short-lived ticket is stored in Redis
- The collaboration service validates the ticket before allowing a WebSocket connection

### Why One Shared Redis Instance?

Running 3 separate Redis nodes would cost 3× more (~$36/month vs ~$12/month). Since we're at MVP scale, one `cache.t4g.micro` node handles the load comfortably.

Services avoid key collisions by using **key prefixes** — a naming convention:

```
match:queue:{difficulty}         ← matching service
match:state:{userId}             ← matching service
collab:ticket:{ticketId}         ← collaboration service
gw:session:{token}               ← api gateway
```

Because these prefixes are enforced in application code, each service only reads/writes its own keys.

### Network Placement

Redis runs in the **private subnets** and is only accessible on port 6379 from within the VPC CIDR (`10.0.0.0/16`). It is completely unreachable from the internet. There is no public endpoint.

---

## 12. Secrets Manager — Safe for Credentials

### The Problem Secrets Solve

You should never commit secrets (passwords, API keys, private keys) to your Git repository. But your services need those secrets at runtime. How do you get them there securely?

**AWS Secrets Manager** stores secrets encrypted at rest and provides an API to retrieve them at runtime. Services call the API using their IAM role (which has `secretsmanager:GetSecretValue` permission) — no hardcoded credentials needed.

### PeerPrep's Secrets

| Secret Name | What's Inside | Used By |
|---|---|---|
| `peerprep/firebase-main` | Firebase service account JSON | api-gateway, user-service |
| `peerprep/firebase-history` | Firebase service account JSON | history-service |
| `peerprep/firebase-question` | Firebase service account JSON | question-service |
| `peerprep/backend-env` | SMTP credentials, API keys | all services |

### Why Three Firebase Secrets?

PeerPrep maintains separate Firebase projects for different microservices (main auth, history, questions). Using one service account JSON per project:
1. If one secret leaks, it only compromises one Firebase project
2. Each service has minimal privileges — only what it needs
3. You can rotate one secret without affecting others

### Two-Tier Secrets Architecture

```
Secret Type                Store              Who Manages It
─────────────────────────  ─────────────────  ─────────────────────────────────
Firebase JSON, API keys    AWS Secrets Mgr    Team (pasted into console once)
AWS credentials for CI/CD  GitHub Secrets     Team (set in GitHub Settings)
Environment variables      Terraform vars     Injected at deploy time
```

### How to Populate a Secret (Manual Step)

Terraform creates the secret "container" but cannot populate the value (the team must do this once manually):

```bash
# Paste your firebase-service-account.json value into Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id peerprep/firebase-main \
  --secret-string file://firebase-service-account.json
```

Or via AWS Console:
1. Go to **Secrets Manager** → select `peerprep/firebase-main`
2. Click **Retrieve secret value** → **Edit**
3. Paste the JSON content → **Save**

### How Services Retrieve Secrets at Runtime

Services read secrets at startup using the AWS SDK:

```python
import boto3, json

client = boto3.client('secretsmanager', region_name='ap-southeast-1')
secret = client.get_secret_value(SecretId='peerprep/firebase-main')
firebase_credentials = json.loads(secret['SecretString'])
```

This works because the Lambda/ECS execution role has `secretsmanager:GetSecretValue` permission — no hardcoded credentials needed.

---

## 13. CloudWatch — Logs and Monitoring

### What is CloudWatch?

**CloudWatch** is AWS's centralised logging and monitoring service. Every service in PeerPrep sends its logs to CloudWatch automatically.

### Log Groups

Logs are organised into **Log Groups**, one per service:

```
/ecs/peerprep-matching-service        (ECS container logs, 7-day retention)
/ecs/peerprep-collaboration-service   (ECS container logs, 7-day retention)
/aws/lambda/peerprep-api-gateway      (Lambda logs, auto-created)
/aws/lambda/peerprep-user-service     (Lambda logs, auto-created)
/aws/lambda/peerprep-question-service
/aws/lambda/peerprep-history-service
/aws/lambda/peerprep-ai-service
```

### How to Read Logs

**AWS Console:**
1. Go to **CloudWatch** → **Log Groups**
2. Select the group (e.g., `/ecs/peerprep-matching-service`)
3. Click a **Log Stream** → see individual log lines with timestamps

**AWS CLI (quicker for debugging):**
```bash
# Tail Lambda logs in real time
aws logs tail /aws/lambda/peerprep-api-gateway --follow

# Tail ECS logs
aws logs tail /ecs/peerprep-matching-service --follow
```

### Container Insights

The ECS cluster has **Container Insights** enabled — this gives you CPU utilisation, memory usage, and network metrics per service in CloudWatch, without any manual instrumentation.

---

## 14. Terraform — Infrastructure as Code

### What is Terraform?

**Terraform** is a tool that lets you describe your entire AWS infrastructure in code (`.tf` files), then creates, updates, or deletes the real AWS resources to match your description.

Instead of clicking through the AWS console to create a VPC, subnets, security groups, load balancers, etc. (100+ steps, error-prone, not reproducible), you write a file and run `terraform apply`.

### The State File

Terraform maintains a **state file** (`terraform.tfstate`) that records the current real-world state of your infrastructure. This is how Terraform knows what already exists vs what needs to be created.

```
You:      "I want a VPC with these settings"
Terraform: (checks state) "A VPC already exists — comparing..."
            "Nothing changed — no action needed"
```

If the state file is lost, Terraform thinks your infrastructure doesn't exist and tries to create everything again (usually causing errors). Keep the state file safe — in a team, store it in an S3 bucket with versioning enabled.

### Terraform Commands

```bash
# One-time setup: download provider plugins
terraform init

# Preview what will be created/changed/deleted (safe — no changes made)
terraform plan

# Actually create/update infrastructure
terraform apply

# Destroy all infrastructure (dangerous — stops all charges but deletes everything)
terraform destroy
```

### PeerPrep's File Structure

```
infrastructure/
├── provider.tf    ← AWS provider + region
├── variables.tf   ← Inputs (frontend URL, region)
├── vpc.tf         ← VPC, subnets, NAT gateway
├── secrets.tf     ← Secrets Manager containers + IAM policy
├── ecr.tf         ← Docker image repositories
├── redis.tf       ← ElastiCache Redis cluster
├── lambda.tf      ← Lambda functions + API Gateway
├── ecs.tf         ← ECS cluster, EC2 hosts, task definitions, services
└── alb.tf         ← Load balancer, target groups, listener rules
```

### What Terraform Does vs What You Do Manually

| Done by Terraform | Done Manually (once) |
|---|---|
| Creates VPC, subnets, NAT Gateway | Populate secrets in Secrets Manager |
| Creates ECR repositories | Set GitHub Actions secrets |
| Creates Lambda functions | Run first CI/CD push to build images |
| Creates ECS cluster, ASG, task definitions | |
| Creates ALB, target groups, listener rules | |
| Creates ElastiCache Redis cluster | |
| Creates CloudFront distribution + S3 bucket | |
| Creates API Gateway | |
| Wires everything together with correct IAM + security groups | |

---

## 15. GitHub Actions — Automated Deployment

### What is GitHub Actions?

**GitHub Actions** is a CI/CD platform built into GitHub. You define **workflows** in YAML files under `.github/workflows/`. These workflows run automatically when you push code.

A workflow is a series of **steps** running on a **runner** (a temporary Linux VM hosted by GitHub). Each step can run shell commands or call pre-built **actions** (reusable scripts published by AWS, the community, or yourself).

### PeerPrep's Trigger Strategy — Path Filters

We have 8 deploy workflows. Each one only triggers when its specific service's code changes:

```yaml
on:
  push:
    branches: [ main ]
    paths:
      - 'backend/matching-service/**'   # Only run if matching-service files changed
```

This means:
- Pushing a fix to `user-service` only triggers `deploy-user-service.yml`
- Pushing frontend changes only triggers `deploy-frontend.yml`
- No unnecessary rebuilds

### The AWS Authentication Step

Every workflow starts by configuring AWS credentials so subsequent `aws` CLI and Docker commands work:

```yaml
- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: ${{ secrets.AWS_REGION }}
```

This injects the IAM User credentials stored in GitHub Secrets into the runner's environment. All subsequent `aws` commands run as this IAM User.

### Lambda Deploy Workflow (Step by Step)

```yaml
# Triggered when: push to main changes backend/user-service/**

jobs:
  deploy:
    runs-on: ubuntu-latest     # Fresh Linux VM for each run
    steps:
      # Step 1: Download the repository code
      - uses: actions/checkout@v4

      # Step 2: Authenticate with AWS using IAM credentials from GitHub Secrets
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      # Step 3: Get a temporary Docker login token for ECR
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
        # This action runs: aws ecr get-login-password | docker login ...
        # Output: steps.login-ecr.outputs.registry = the ECR registry URL

      # Step 4: Build the Docker image and push two tags to ECR
      - name: Build, Tag, and Push Image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}           # The git commit SHA (e.g., a3f9b12...)
        run: |
          docker build \
            -t $ECR_REGISTRY/peerprep/user-service:latest \
            -t $ECR_REGISTRY/peerprep/user-service:$IMAGE_TAG \
            ./backend/user-service
          docker push $ECR_REGISTRY/peerprep/user-service:latest
          docker push $ECR_REGISTRY/peerprep/user-service:$IMAGE_TAG

      # Step 5: Tell Lambda to use the new image
      - name: Update Lambda Function
        run: |
          aws lambda update-function-code \
            --function-name peerprep-user-service \
            --image-uri $ECR_REGISTRY/peerprep/user-service:${{ github.sha }}
      # Lambda immediately starts using the new image on the next invocation
```

### ECS Deploy Workflow (Step by Step)

ECS requires one extra step — updating the Task Definition — because ECS doesn't pull the `:latest` tag automatically. You must create a new Task Definition revision with the new image URI.

```yaml
# After build + push (same as Lambda)...

# Step 5: Download the CURRENT task definition from AWS
- name: Download Task Definition
  run: |
    aws ecs describe-task-definition \
      --task-definition peerprep-matching-service \
      --query taskDefinition > task-definition.json

# Step 6: Replace the image URI in the task definition JSON
- name: Update image in Task Definition
  id: task-def
  uses: aws-actions/amazon-ecs-render-task-definition@v1
  with:
    task-definition: task-definition.json
    container-name: matching-service
    image: ${{ steps.login-ecr.outputs.registry }}/peerprep/matching-service:${{ github.sha }}
  # Output: steps.task-def.outputs.task-definition = path to updated JSON file

# Step 7: Register the new task definition revision and trigger rolling deploy
- name: Deploy to ECS
  uses: aws-actions/amazon-ecs-deploy-task-definition@v1
  with:
    task-definition: ${{ steps.task-def.outputs.task-definition }}
    service: peerprep-matching-service
    cluster: peerprep-cluster
    wait-for-service-stability: true   # Wait until new task is healthy before finishing
```

`wait-for-service-stability: true` means the workflow waits (and fails the CI job if the deploy fails) — so you'll know immediately in GitHub if the deployment broke.

### Frontend Deploy Workflow (Step by Step)

```yaml
# Step 1: Checkout
# Step 2: Setup Node.js 20
- uses: actions/setup-node@v4
  with: { node-version: 20 }

# Step 3: Build the React app
- name: Build Production Assets
  working-directory: frontend
  env:
    VITE_GATEWAY_URL: "/api"      # All API calls go to /api (CloudFront proxies to API GW)
  run: |
    npm install
    npm run build
  # Output: frontend/dist/ (HTML, JS, CSS)

# Step 4: Authenticate with AWS (same as above)

# Step 5: Upload to S3 (--delete removes files that no longer exist in dist/)
- name: Deploy to S3
  run: aws s3 sync frontend/dist s3://peerprep-frontend-${{ secrets.AWS_ACCOUNT_ID }} --delete

# Step 6: Invalidate CloudFront cache (users see new version immediately)
- name: Invalidate CloudFront Cache
  run: |
    aws cloudfront create-invalidation \
      --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
      --paths "/*"
```

---

## 16. How It All Fits Together — End-to-End Request Walk

### Request 1: User opens the app for the first time

```
1. Browser requests https://xxxx.cloudfront.net/
2. CloudFront checks its cache → miss (first visit)
3. CloudFront requests /index.html from S3
4. S3 returns index.html (CloudFront has OAC permission to read it)
5. CloudFront caches the response at the nearest edge location
6. Browser receives index.html → React app boots up
7. Browser requests /assets/index-Abc123.js
8. CloudFront cache hit → returned immediately from edge (fast!)
```

### Request 2: User logs in (API call)

```
1. React calls fetch("/api/auth/login", { method: "POST", body: {...} })
2. CloudFront path matches /api/* → forwards to API Gateway
3. API Gateway receives request → invokes peerprep-api-gateway Lambda
4. Lambda cold starts (if idle) — pulls container from ECR cache if warm
5. Lambda validates the request, routes to user-service Lambda Function URL
6. user-service Lambda processes login, calls Firebase Auth API via outbound NAT
7. user-service creates a session token in Redis
8. Response flows back: user-service → api-gateway Lambda → API Gateway → CloudFront → Browser
```

### Request 3: User finds a match (SSE)

```
1. React opens an SSE connection: fetch("/api/matching/queue", { method: "POST" })
2. CloudFront → API Gateway → api-gateway Lambda → ALB /matching/*
   Wait — /matching/* goes to ALB directly from CloudFront, not via API Gateway
   Actually: CloudFront /collab/* → ALB → matching-service ECS
3. ALB routes to matching-service ECS task (IP:8001)
4. Matching service adds user to Redis queue with key match:queue:{difficulty}
5. Matching service worker polls the queue and finds a pair
6. SSE event sent to both browsers: "Match found! Redirect to /collab/{roomId}"
7. Both browsers disconnect SSE and redirect to the collaboration room
```

### Request 4: User enters collaboration room (WebSocket)

```
1. React page loads at /collab/{roomId}
2. React opens WebSocket: new WebSocket("wss://xxxx.cloudfront.net/socket.io/...")
3. CloudFront path /socket.io/* → forwards to ALB (with Upgrade header intact)
4. ALB forwards to collaboration-service ECS task (IP:3001)
5. Collaboration service accepts WebSocket upgrade
6. Yjs document sync begins — real-time keystrokes flow over the WebSocket
7. Connection stays open for the entire session (minutes to hours)
8. ALB + ECS keep the connection alive — Lambda could never do this
```

---

## 17. Manual Deployment Steps (What Terraform Cannot Do)

Terraform builds the skeleton. A few things must be done manually once:

### Step 1: Bootstrap Terraform

```bash
cd infrastructure
terraform init      # Download provider plugins
terraform apply     # Create all AWS resources (~10 minutes)
```

Terraform outputs important values:
```
alb_dns_name                = "peerprep-alb-xxxx.ap-southeast-1.elb.amazonaws.com"
api_gateway_url             = "https://tsesok37w7.execute-api.ap-southeast-1.amazonaws.com"
frontend_cloudfront_url     = "https://xxxx.cloudfront.net"
frontend_cloudfront_distribution_id = "EXAMPLEID"
redis_endpoint              = "peerprep-redis.xxx.cache.amazonaws.com"
ecr_repository_urls         = { api-gateway = "...", user-service = "...", ... }
```

Save these — you'll need them in the next steps.

### Step 2: Populate Secrets Manager

For each secret, go to **AWS Console → Secrets Manager** (in ap-southeast-1) and click each secret to paste the value:

| Secret | What to paste |
|---|---|
| `peerprep/firebase-main` | Contents of your main Firebase service account JSON |
| `peerprep/firebase-history` | Contents of history Firebase service account JSON |
| `peerprep/firebase-question` | Contents of question Firebase service account JSON |
| `peerprep/backend-env` | JSON object with `SMTP_HOST`, `SMTP_USER`, etc. |

### Step 3: Set GitHub Actions Secrets

In GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | From your IAM User |
| `AWS_SECRET_ACCESS_KEY` | From your IAM User |
| `AWS_REGION` | `ap-southeast-1` |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account number |
| `CLOUDFRONT_DISTRIBUTION_ID` | From Terraform output |

### Step 4: Trigger First Deployment

Push to `main` (or run each workflow manually via `workflow_dispatch`) to build and push all Docker images and deploy all services.

You can also trigger from the CLI:

```bash
# Trigger a specific workflow manually
gh workflow run deploy-api-gateway.yml --ref main
```

### Step 5: Verify Everything is Running

```bash
# Check ECS services
aws ecs describe-services \
  --cluster peerprep-cluster \
  --services peerprep-matching-service peerprep-collaboration-service \
  --query 'services[*].{Name:serviceName,Running:runningCount,Desired:desiredCount}'

# Check Lambda functions exist
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `peerprep`)].FunctionName'

# Test the frontend
curl -I https://{your-cloudfront-url}/

# Test the API
curl https://{your-cloudfront-url}/api/health
```

---

## Quick Reference: AWS Service Cheat Sheet

| Service | Category | What it does in PeerPrep | Cost driver |
|---|---|---|---|
| **S3** | Storage | Stores the built React SPA files | Storage + egress (very cheap) |
| **CloudFront** | CDN + Router | Global delivery + routes /api, /collab, /socket.io | Data transfer |
| **API Gateway** | API | Public HTTPS entry point for REST calls | Per-request |
| **Lambda** | Compute | Runs api-gateway, user, question, history, ai services | Per-invocation + ms |
| **ECR** | Registry | Stores Docker images for all 7 services | Storage |
| **ECS** | Compute | Runs matching + collaboration containers 24/7 | EC2 instance time |
| **EC2** | Compute | The t3.small virtual machines under ECS | Hourly |
| **ALB** | Networking | Routes HTTP traffic to ECS services | Hourly + LCU |
| **ElastiCache** | Cache | Shared Redis for sessions, queues, pub/sub | Hourly |
| **VPC + NAT** | Networking | Private network + outbound internet for private services | NAT = hourly + data |
| **Secrets Manager** | Security | Stores Firebase JSON + env vars | Per-secret/month |
| **CloudWatch** | Monitoring | Centralised logs for all services | Ingestion + storage |
| **IAM** | Security | Roles + policies controlling who can do what | Free |
