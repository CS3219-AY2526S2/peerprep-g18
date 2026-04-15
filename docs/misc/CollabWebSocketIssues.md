# Collaboration Service WebSocket Issues

## Overview

Four issues were identified in the Terraform infrastructure and collaboration service code that cause or risk breaking WebSocket connectivity.

---

## Issue 1 — Missing ALB Stickiness (Critical)

**File:** `infrastructure/alb.tf:53–68`

The `collaboration_tg` target group has no `stickiness` block. Socket.IO's editor socket uses the default `['polling', 'websocket']` transport sequence:

1. Client opens an HTTP long-poll to `/socket.io/?EIO=4&transport=polling`
2. Server creates an engine.io session (`sid`) held **in memory on a specific ECS task**
3. Client sends a WebSocket upgrade request referencing that `sid`

Without sticky sessions, ALB can route step 3 to a **different ECS task** than step 1. That task has no record of the `sid` and rejects the upgrade with `Session ID unknown`.

This fails silently during any rolling deployment when two ECS tasks briefly coexist, and will consistently break if `desired_count` is ever raised above 1.

The chat socket uses `transports: ['websocket']` (skipping polling), so it is less immediately affected — but it will also fail under the same conditions.

**Fix:**

```hcl
resource "aws_lb_target_group" "collaboration_tg" {
  name        = "collaboration-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }

  health_check {
    path                = "/collab/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
    matcher             = "200,404"
  }
}
```

---

## Issue 2 — Server Will Not Start if Redis is Slow (High)

**File:** `backend/collaboration-service/server.js:724–745`

The server only calls `server.listen()` after all three Redis connections succeed:

```javascript
Promise.all([
  redisClient.connect(),
  pubClient.connect(),
  subClient.connect(),
]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  server.listen(PORT, () => { ... });
});
```

If any Redis connection takes longer than the ECS health check grace period (60 seconds), the ALB health check hits port 3001 and receives a connection refused. ECS marks the task unhealthy and replaces it — which then has to reconnect to Redis again, creating a restart loop.

ElastiCache in the same VPC is usually fast, but this is brittle during cold starts or any Redis blip.

**Fix:** Start listening on the port immediately. Return `503` from the health endpoint until Redis is ready, then switch to `200`.

```javascript
let redisReady = false;

app.get('/collab/health', (req, res) => {
  res.status(redisReady ? 200 : 503).send(redisReady ? 'OK' : 'Starting');
});

app.get('/health', (req, res) => {
  res.status(redisReady ? 200 : 503).send(redisReady ? 'OK' : 'Starting');
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Collaboration Service running on port ${PORT}`);
});

Promise.all([
  redisClient.connect().then(() => console.log('Connected to redis-sessions')),
  pubClient.connect(),
  subClient.connect(),
]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  redisReady = true;
  console.log('Socket.IO Redis adapter attached');
  ...
});
```

Also update the ALB health check matcher to accept `503` during startup:

```hcl
health_check {
  matcher = "200,503"
}
```

---

## Issue 3 — Dead CloudFront Behaviors (Medium)

**File:** `infrastructure/frontend.tf:83–105`

CloudFront has ordered behaviors for `/editor/*` and `/chat/*` routing to `ALB-Collaboration`:

```hcl
ordered_cache_behavior {
  path_pattern     = "/editor/*"
  target_origin_id = "ALB-Collaboration"
  ...
}

ordered_cache_behavior {
  path_pattern     = "/chat/*"
  target_origin_id = "ALB-Collaboration"
  ...
}
```

These behaviors are never triggered because:

1. The ALB has **no listener rules** for `/editor/*` or `/chat/*`. Traffic reaching the ALB on those paths falls through to the default fixed-response action (`"PeerPrep ALB - Use /matching or /collab paths"`).
2. The frontend connects to Socket.IO namespaces (`/editor`, `/chat`) using `path: '/socket.io'` explicitly. All Socket.IO HTTP traffic — regardless of namespace — uses the `/socket.io/*` path. The namespace is communicated inside the Socket.IO protocol, not in the URL.

These behaviors are dead weight. If anything ever does reach the ALB via those paths, it gets a misleading 200 fixed-response instead of an error.

**Fix:** Remove the `/editor/*` and `/chat/*` ordered cache behaviors from `frontend.tf`. All Socket.IO traffic is already covered by the `/socket.io/*` behavior.

---

## Issue 4 — Dockerfile Exposes Wrong Port (Low)

**File:** `backend/collaboration-service/Dockerfile:14`

```dockerfile
EXPOSE 4000
```

The ECS task definition injects `PORT=3001`, so the server actually listens on `3001`. The `EXPOSE` directive is documentation-only and does not affect runtime, but it contradicts the target group port (`3001`), the port mapping in `ecs.tf`, and the `PORT` environment variable.

**Fix:**

```dockerfile
EXPOSE 3001
```

---

## Summary

| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | `infrastructure/alb.tf:53` | Missing stickiness on collaboration target group | Critical |
| 2 | `backend/collaboration-service/server.js:724` | Server blocks `listen()` on Redis startup | High |
| 3 | `infrastructure/frontend.tf:83` | Dead `/editor/*` and `/chat/*` CloudFront behaviors | Medium |
| 4 | `backend/collaboration-service/Dockerfile:14` | `EXPOSE 4000` should be `EXPOSE 3001` | Low |
