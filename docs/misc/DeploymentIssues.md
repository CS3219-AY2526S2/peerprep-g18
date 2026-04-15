# AWS Deployment Issues

Issues identified across Terraform infrastructure (`infrastructure/`) and GitHub Actions CI/CD (`.github/workflows/`).

---

## Issue 1 — Lambda Internal Services Have Hardcoded Docker Compose URLs (Critical)

**File:** `infrastructure/lambda.tf:133–136`

The `internal_lambda_services` (user-service, question-service, history-service, ai-service) have their cross-service URLs set to Docker Compose hostnames:

```hcl
USER_SERVICE_URL     = "http://user-service:6767"
QUESTION_SERVICE_URL = "http://question-service:6768"
HISTORY_SERVICE_URL  = "http://history-service:6770"
AI_SERVICE_URL       = "http://ai-service:6771"
```

These hostnames don't resolve inside AWS Lambda. Any internal service that calls another internal service (e.g., history-service calling question-service) will fail with a connection error in production.

The `api_gateway` Lambda correctly uses the real Lambda Function URLs, but the internal services do not.

**Fix:** Replace the placeholder URLs with the actual Lambda Function URLs after the initial `terraform apply`. Since `ignore_changes = [environment]` is set (see Issue 2), this must be done via the AWS console, AWS CLI, or by removing the `ignore_changes` constraint:

```hcl
USER_SERVICE_URL     = aws_lambda_function_url.internal_service_urls["user-service"].function_url
QUESTION_SERVICE_URL = aws_lambda_function_url.internal_service_urls["question-service"].function_url
HISTORY_SERVICE_URL  = aws_lambda_function_url.internal_service_urls["history-service"].function_url
AI_SERVICE_URL       = aws_lambda_function_url.internal_service_urls["ai-service"].function_url
```

Note: this creates a circular dependency because the Function URLs depend on the Lambda functions themselves. The standard workaround is a two-phase apply: first apply without the cross-service URLs, then apply again once the URLs are known. This is already handled correctly for `api_gateway` — apply the same pattern to `internal_services`.

---

## Issue 2 — `ignore_changes = [environment]` Locks Lambda Env Vars After First Deploy (Critical)

**File:** `infrastructure/lambda.tf:142–144`

Both the `internal_services` and `api_gateway` Lambda functions have:

```hcl
lifecycle {
  ignore_changes = [image_uri, environment]
}
```

`ignore_changes = [image_uri]` is correct — image updates go through CI/CD. But `ignore_changes = [environment]` means **Terraform will never update environment variables after the first `terraform apply`**, even if you change them in the `.tf` files.

Combined with Issue 1 (placeholder URLs), this means:
- The Lambdas are deployed with broken URLs.
- Fixing the URLs in Terraform and re-applying does nothing.
- The only way to update them is via the AWS console or AWS CLI manually.

**Fix:** Remove `environment` from `ignore_changes`. Environment variable changes should be managed by Terraform, not CI/CD:

```hcl
lifecycle {
  ignore_changes = [image_uri]  # CI/CD manages image updates; Terraform manages env vars
}
```

---

## Issue 3 — Lambda Deploy Workflows Don't Wait for Update to Complete (High)

**Files:** `deploy-api-gateway.yml`, `deploy-user-service.yml`, `deploy-history-service.yml`, `deploy-question-service.yml`, `deploy-ai-service.yml`

All Lambda deploy workflows end with:

```yaml
- name: Update Lambda Function
  run: |
    aws lambda update-function-code \
      --function-name peerprep-<service> \
      --image-uri ...
```

`update-function-code` is asynchronous. The workflow reports success the moment the update is queued, but the Lambda can still be in `Updating` state and serving the old image for several minutes. If a smoke test, health check, or a dependent job were added after this step, it would run against the old version.

Compare with the ECS workflows, which correctly use `wait-for-service-stability: true`.

**Fix:** Add a wait step after each Lambda update:

```yaml
- name: Update Lambda Function
  run: |
    aws lambda update-function-code \
      --function-name peerprep-<service> \
      --image-uri ${{ steps.login-ecr.outputs.registry }}/peerprep/<service>:${{ github.sha }}

- name: Wait for Lambda update
  run: |
    aws lambda wait function-updated \
      --function-name peerprep-<service>
```

---

## Issue 4 — No Terraform Remote Backend or State Locking (High)

**File:** `infrastructure/provider.tf`

The Terraform configuration has no `backend` block:

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  # No backend configured — state is stored locally
}
```

This means:
- Each developer has their own local `terraform.tfstate` file.
- Concurrent `terraform apply` runs from different machines will diverge and corrupt state.
- No CI/CD pipeline can run `terraform plan` or `terraform apply` without the state file.
- There is no state locking to prevent simultaneous applies.

**Fix:** Add an S3 backend with DynamoDB locking:

```hcl
terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }

  backend "s3" {
    bucket         = "peerprep-terraform-state-655738707953"
    key            = "peerprep/terraform.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "peerprep-terraform-locks"
    encrypt        = true
  }
}
```

The S3 bucket and DynamoDB table must be created manually before the first `terraform init` (they can't be managed by the same Terraform config that uses them).

---

## Issue 5 — No Terraform CI/CD Pipeline (High)

**Files:** `.github/workflows/` (missing)

There is no workflow to:
- Run `terraform plan` on pull requests to preview infrastructure changes.
- Run `terraform apply` on merge to keep infrastructure in sync with code.

Infrastructure changes must be run manually by whoever has AWS credentials. This means:
- Changes checked into `infrastructure/` aren't automatically applied.
- There's no PR review of planned infrastructure changes.
- It's easy for the live infrastructure to drift from the Terraform source.

**Fix:** Add a workflow like:

```yaml
name: Terraform

on:
  pull_request:
    paths: [ 'infrastructure/**' ]
  push:
    branches: [ main ]
    paths: [ 'infrastructure/**' ]

jobs:
  terraform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Terraform Init
        run: terraform init
        working-directory: infrastructure

      - name: Terraform Plan
        run: terraform plan -out=tfplan
        working-directory: infrastructure

      - name: Terraform Apply   # Only on push to main
        if: github.event_name == 'push'
        run: terraform apply -auto-approve tfplan
        working-directory: infrastructure
```

Requires Issue 4 (remote backend) to be solved first.

---

## Issue 6 — ECS Rolling Deployment Breaks Active WebSocket Sessions (Medium)

**File:** `infrastructure/ecs.tf:239–264`

The ECS service has no `deployment_configuration` block, so it uses AWS defaults (100% minimum healthy percent, 200% maximum). For `desired_count = 1`, a rolling deployment:

1. Starts a new task → 2 tasks are briefly running
2. Waits for the new task to pass health checks
3. Drains and stops the old task

During step 1–2, the ALB load-balances across both tasks. Because there is no sticky session on the collaboration target group (see WebSocket issues doc), active Socket.IO connections to the old task continue working, but new connection requests may land on either task. When the old task is drained in step 3, every Socket.IO connection it was serving is dropped simultaneously.

**Fix:** In addition to adding ALB stickiness, enable connection draining on the target group to gracefully move existing connections:

```hcl
resource "aws_lb_target_group" "collaboration_tg" {
  ...
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }

  deregistration_delay = 30  # Seconds to drain connections before removing the old task
}
```

Consider also configuring a blue/green deployment if zero-downtime is a hard requirement.

---

## Issue 7 — `deploy-on-deployment.yml` Fires All Deploys With No Ordering or Failure Handling (Medium)

**File:** `.github/workflows/deploy-on-deployment.yml`

The `deployment` branch workflow triggers all 7 service deploys simultaneously:

```bash
for service in "${services[@]}"; do
  gh workflow run "$service" --ref deployment
done
```

Issues:
- Workflows are dispatched fire-and-forget. If ECR auth fails for the first service, the loop continues and triggers the rest anyway.
- No failure aggregation — the triggering workflow always reports green even if all 7 child deploys fail.
- No ordering — if a service depends on another being deployed first, there's no mechanism to enforce that.

**Fix:** Use `gh workflow run` with polling to detect failures, or use a reusable workflow with proper `needs:` dependencies between services. At minimum, add `set -e` and check exit codes:

```bash
set -e
for service in "${services[@]}"; do
  echo "Triggering $service..."
  gh workflow run "$service" --ref deployment
done
```

For proper failure detection, poll the triggered runs:

```bash
RUN_ID=$(gh run list --workflow "$service" --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

---

## Issue 8 — All Lambda Functions Are in the VPC (Medium)

**File:** `infrastructure/lambda.tf:118–121`

Every Lambda (user-service, question-service, history-service, ai-service, api-gateway) is placed inside the private VPC:

```hcl
vpc_config {
  subnet_ids         = module.vpc.private_subnets
  security_group_ids = [aws_security_group.lambda_sg.id]
}
```

VPC-attached Lambdas have significantly higher cold start times because AWS must provision an Elastic Network Interface (ENI) for each function instance. Lambdas that don't need access to private VPC resources (Redis, internal ALB) should run outside the VPC.

Of the internal services:
- **user-service**: Likely needs VPC for Redis session access — keep in VPC.
- **question-service**: Reads from Firestore (public internet) — may not need VPC.
- **history-service**: Writes to Firestore + may read Redis — evaluate.
- **ai-service**: Calls an external AI API — does not need VPC.
- **api-gateway**: Needs to reach Redis and the ALB — keep in VPC.

**Fix:** Remove `vpc_config` from Lambdas that only access public internet resources (Firestore, external APIs). Only keep VPC config for Lambdas that need to reach Redis or the internal ALB.

---

## Summary

| # | File | Issue | Severity |
|---|------|-------|----------|
| 1 | `lambda.tf:133` | Internal Lambda services have hardcoded Docker Compose URLs | Critical |
| 2 | `lambda.tf:142` | `ignore_changes = [environment]` prevents Terraform from fixing env vars | Critical |
| 3 | All Lambda deploy workflows | `update-function-code` not awaited before workflow exits | High |
| 4 | `provider.tf` | No remote Terraform backend — local state, no locking | High |
| 5 | `.github/workflows/` | No Terraform CI/CD pipeline | High |
| 6 | `ecs.tf:239` | Rolling deploy drops WebSocket sessions (no connection draining or stickiness) | Medium |
| 7 | `deploy-on-deployment.yml` | All deploys fire in parallel with no ordering or failure detection | Medium |
| 8 | `lambda.tf:118` | All Lambdas in VPC increases cold start latency unnecessarily | Medium |
