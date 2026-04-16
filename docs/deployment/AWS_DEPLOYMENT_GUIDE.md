# AWS Deployment Guide (Terraform + GitHub Actions)

This guide provides a comprehensive, step-by-step walkthrough for deploying the PeerPrep microservices architecture to AWS using **Terraform** (Infrastructure as Code) and **GitHub Actions** (CI/CD). 

As per the requirements, we are retaining **Firebase Auth** for authentication and **Firestore** as the primary database, focusing entirely on deploying the compute, networking, and caching layers.

---

## 1. Architecture Overview & Network Fundamentals

Before diving into the code, here is a brief explanation of the networking components we will be configuring via Terraform:

*   **VPC (Virtual Private Cloud):** Think of this as your own secure, isolated private network within AWS. All your backend services will live inside this VPC.
*   **Subnets:** Sub-sections of the VPC. We divide our VPC into two types for security and high availability (spanning two Availability Zones):
    *   **Public Subnets:** These have direct access to the internet. We place our Application Load Balancer (ALB) and NAT Gateways here.
    *   **Private Subnets:** These have no direct internet access. Services placed here can reach the internet *outward* (e.g., to talk to Firebase) via the NAT Gateway, but the internet cannot reach them directly. This is where we place our ECS tasks, Lambda functions, and the Redis cache.
*   **Security Groups (SGs):** Virtual firewalls attached to your resources. We configure these so that, for example, your Redis cluster *only* accepts traffic coming from the specific Security Groups assigned to your Lambda and ECS services.
*   **AWS Secrets Manager:** Securely stores your Firebase Service Account JSON files and environment variables. Services pull these securely at runtime instead of hardcoding them.

---

## 2. Infrastructure as Code (Terraform) Setup

We will organize our infrastructure configuration in an `infrastructure/` folder at the root of the repository.

### Prerequisites
1.  Install [Terraform CLI](https://developer.hashicorp.com/terraform/downloads).
    - On Windows: `choco install terraform`
2.  Install the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and configure it (`aws configure`).

### Step 2.1: Base Networking & Variables
This step builds the networking backbone in the **Singapore (`ap-southeast-1`)** region.

#### A. Folder Structure
Create an `infrastructure/` directory at the project root to house your Terraform files.

#### B. Provider Configuration (`infrastructure/provider.tf`)
Tells Terraform to use the AWS provider and target the correct region using a variable.
```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}
```

#### C. Variables Definition (`infrastructure/variables.tf`)
Defines inputs that allow CI/CD to inject configuration (like the Frontend URL) dynamically.
```hcl
variable "frontend_url" {
  description = "The URL of the deployed frontend (e.g., CloudFront URL)"
  type        = string
  default     = "*" # Default to * for initial bootstrap, managed by CI/CD later
}

variable "region" {
  description = "AWS Region"
  type        = string
  default     = "ap-southeast-1"
}
```

#### D. VPC Definition (`infrastructure/vpc.tf`)
Using the official `terraform-aws-modules/vpc/aws` module, we define:
*   **Public Subnets (x2):** For the Application Load Balancer (ALB).
*   **Private Subnets (x2):** For ECS Tasks, Lambdas, and Redis.
*   **NAT Gateway:** Allows private services to send outbound requests (e.g., to Firebase/Firestore) while remaining unreachable from the public internet.

##### **NAT Gateway Scaling & Cost Optimization**
In `vpc.tf`, we use the `single_nat_gateway = true` flag. This is a deliberate architectural decision:
- **Cost-Saving (Dev):** A single NAT Gateway costs ~\$32/month. This is the recommended setting for development and testing.
- **Scaling for Production (High Availability):** If the application scales to production and requires high availability (HA) across multiple Availability Zones:
    - Set `single_nat_gateway = false`.
    - Set `one_nat_gateway_per_az = true`.
- **Impact of HA:** This will provision one NAT Gateway per Availability Zone (totaling 2 in our current setup). This removes the single point of failure but doubles the NAT Gateway cost to ~\$64/month.

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.5.0"

  name = "peerprep-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["ap-southeast-1a", "ap-southeast-1b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = true # Cost-saving for dev; use 'false' for high availability production

  tags = {
    Environment = "dev"
    Project     = "PeerPrep"
  }
}
```

### Step 2.2: Secrets Management
To avoid hardcoding sensitive information like Firebase Service Account JSONs or SMTP passwords, we use **AWS Secrets Manager**. 

#### A. Secrets Definition (`infrastructure/secrets.tf`)
Create "containers" for your secrets. Here, we create three for the different Firebase projects and one for general Backend environment variables.

```hcl
# 1. Main Firebase Service Account (Used by API Gateway for JWT verification & User Service)
resource "aws_secretsmanager_secret" "firebase_main" {
  name        = "peerprep/firebase-main"
  description = "Main Firebase Service Account JSON for API Gateway and User Service"
  recovery_window_in_days = 0 # Force immediate deletion if destroyed (saves cost)
}

# 2. History Service Firebase Service Account (Used by Question History Service)
resource "aws_secretsmanager_secret" "firebase_history" {
  name        = "peerprep/firebase-history"
  description = "History Service Firebase Service Account JSON"
  recovery_window_in_days = 0
}

# 3. Question Service Firebase Service Account (Used by Question Service)
resource "aws_secretsmanager_secret" "firebase_question" {
  name        = "peerprep/firebase-question"
  description = "Question Service Firebase Service Account JSON"
  recovery_window_in_days = 0
}

# 4. Secret for Backend Environment Variables (SMTP, API Keys, etc.)
resource "aws_secretsmanager_secret" "backend_env" {
  name        = "peerprep/backend-env"
  description = "Environment variables for PeerPrep microservices"
  recovery_window_in_days = 0
}
```

#### B. IAM Access Policy
Services (Lambda/ECS) need permission to read these secrets. We will define an IAM policy that we can later attach to our service execution roles.

```hcl
resource "aws_iam_policy" "secrets_read_policy" {
  name        = "PeerPrepSecretsReadPolicy"
  description = "Allows reading all PeerPrep secrets from Secrets Manager"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = "secretsmanager:GetSecretValue"
        Effect   = "Allow"
        Resource = [
          aws_secretsmanager_secret.firebase_main.arn,
          aws_secretsmanager_secret.firebase_history.arn,
          aws_secretsmanager_secret.firebase_question.arn,
          aws_secretsmanager_secret.backend_env.arn
        ]
      }
    ]
  })
}
```

#### C. Execution
Run `terraform init`, `terraform plan`, and `terraform apply` to provision the containers. Upload your JSON files manually via the AWS Console as described in the Manual Step of the guide below.

#### D. Manual Step: Uploading the JSON
Terraform only creates the *empty* secret. You must manually upload your Firebase JSON content once:
1.  Go to the **AWS Secrets Manager Console**.
2.  Select `peerprep/firebase-*`.
3.  Click **Retrieve secret value** > **Set secret value**.
4.  Paste the contents of your `firebase-*.json` into their respective Secret Container and save.
5.  Select `peerprep/backend-env`.
6.  Click **Retrieve secret value** > **Set secret value**.
7.  Paste the contents of your all your `.env` throughout the project as a json and save.
```
{
    "SMTP_EMAIL": "[REDACTED]",
    "SMTP_PASSWORD": "[REDACTED]",
    "GEMINI_API_KEY": "[REDACTED]"
}
```

---

### Step 2.3: ElastiCache (Redis)
Our Matching and Collaboration services use Redis for real-time queues and state. We deploy a single-node Redis cluster in our **Private Subnets** for security.

#### A. Redis Configuration (`infrastructure/redis.tf`)
```hcl
# 1. Security Group for Redis
resource "aws_security_group" "redis_sg" {
  name        = "peerprep-redis-sg"
  description = "Allow inbound traffic to Redis from VPC services"
  vpc_id      = module.vpc.vpc_id

  # Allow inbound traffic on port 6379 from the VPC CIDR
  # In a strict production setup, change this to specific service Security Groups
  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [module.vpc.vpc_cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 2. Redis Subnet Group
resource "aws_elasticache_subnet_group" "redis_subnets" {
  name       = "peerprep-redis-subnet-group"
  subnet_ids = module.vpc.private_subnets
}

# 3. Redis Cluster (Single Node for Cost Optimization)
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "peerprep-redis"
  engine               = "redis"
  node_type            = "cache.t4g.micro" # Smallest and cheapest
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis_subnets.name
  security_group_ids   = [aws_security_group.redis_sg.id]

  tags = {
    Name = "PeerPrepRedis"
  }
}

# 4. Output the Redis Endpoint
output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}
```

---

### Step 2.4: Elastic Container Registry (ECR)
Before we can deploy our services, we need a place to store our Docker images. We use **Amazon ECR**, a fully managed Docker container registry. We will create one private repository for each of our 7 microservices.

#### A. Repository Configuration (`infrastructure/ecr.tf`)
We use a `for_each` loop to cleanly create all repositories at once and attach a **Lifecycle Policy** to each. This policy automatically deletes old images (keeping only the last 3), which is crucial for controlling storage costs in a development environment.

```hcl
locals {
  services = [
    "api-gateway",
    "user-service",
    "question-service",
    "history-service",
    "ai-service",
    "matching-service",
    "collaboration-service"
  ]
}

# 1. Private Repositories
resource "aws_ecr_repository" "service_repos" {
  for_each             = toset(local.services)
  name                 = "peerprep/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true # Automatically scans for vulnerabilities on every push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  force_delete = true # Allows 'terraform destroy' to work even if the repo contains images
}

# 2. Lifecycle Policy (Cost Optimization)
resource "aws_ecr_lifecycle_policy" "cleanup_policy" {
  for_each   = aws_ecr_repository.service_repos
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep only the last 3 images to save on storage costs"
      selection = {
        tagStatus     = "any"
        countType     = "imageCountMoreThan"
        countNumber   = 3
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# 3. Output Repository URLs
output "ecr_repository_urls" {
  value = { for k, v in aws_ecr_repository.service_repos : k => v.repository_url }
  description = "The URLs for the ECR repositories (used in GitHub Actions)"
}
```

#### B. Execution
Run these commands in the `infrastructure/` directory to build your image registry:
1.  **`terraform plan`**: **The Safety Check.** This confirms the creation of 7 independent repositories and verifies that the lifecycle policies (the "auto-cleanup" rules) are correctly linked to each one.
2.  **`terraform apply`**: **The Action Step.** This provisions the repositories in AWS. Once finished, you will have 7 empty registries ready to receive your Docker images from GitHub Actions.

#### C. Validation
1.  Open the **Amazon ECR Console**.
2.  Verify that 7 repositories starting with `peerprep/` (e.g., `peerprep/api-gateway`) are listed.
3.  Click on any repository and check the **Lifecycle policy** tab to ensure the "Keep last 3 images" rule is active.

### Step 2.4.1: Initial Docker Image Upload
Before deploying the compute layer (Step 2.5), each ECR repository must contain at least one image. AWS validates the image URI during the creation of Lambda functions and ECS Task Definitions; if the repository is empty, the deployment will fail.

> After the `ecr.tf` is created, running `terraform apply`, you should be able to see the Containers in AWS ECR. Click on any one of it, and click on "View push command" for a more dedicated information.

#### A. Authenticate Docker to ECR
Run this command to get a login token and authenticate your Docker CLI to your registry (replace `<AWS_ACCOUNT_ID>` and `<REGION>`):
```bash
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
```

#### B. Build, Tag, and Push (Automated Script)
To save time, we provide a bootstrap script that handles all 7 microservices in one go.

**For Linux/macOS:**
```bash
# 1. Make the script executable
chmod +x scripts/bootstrap_ecr.sh

# 2. Run the script (replace with your Account ID)
./scripts/bootstrap_ecr.sh <AWS_ACCOUNT_ID> ap-southeast-1
```

**For Windows (PowerShell):**
```powershell
# Run the script (replace with your Account ID)
.\scripts\bootstrap_ecr.ps1 -AWS_ACCOUNT_ID <AWS_ACCOUNT_ID> -REGION ap-southeast-1
```

#### C. Manual Example (Reference)
If you need to push a single service manually (e.g., `api-gateway`):
1. **Build**: `docker build -t peerprep/api-gateway ./backend/api-gateway`
2. **Tag**: `docker tag peerprep/api-gateway:latest <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/peerprep/api-gateway:latest`
3. **Push**: `docker push <AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/peerprep/api-gateway:latest`

*Note: In production, this is handled by the GitHub Actions pipeline (Step 3), but the first push is often done manually to "bootstrap" the infrastructure.*

---

### Step 2.5: Frontend (S3 + CloudFront)
We deploy the frontend first to generate the **CloudFront URL**, which is required to secure our Backend CORS.

#### A. Frontend Configuration (`infrastructure/frontend.tf`)
```hcl
# 1. S3 Bucket for Frontend Assets
resource "aws_s3_bucket" "frontend_bucket" {
  bucket        = "peerprep-frontend-<AWS_ACCOUNT_ID>"  # Replace with your AWS_ACCOUNT_ID
  force_destroy = true                                  # Allows deletion of bucket even if it contains files

  tags = {
    Name = "PeerPrepFrontendBucket"
  }
}

# 2. Block Public Access to S3
resource "aws_s3_bucket_public_access_block" "frontend_bucket_block" {
  bucket = aws_s3_bucket.frontend_bucket.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 3. CloudFront Origin Access Control (OAC)
resource "aws_cloudfront_origin_access_control" "frontend_oac" {
  name                              = "peerprep-frontend-oac"
  description                       = "OAC for PeerPrep Frontend S3 Bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# 4. CloudFront Distribution
resource "aws_cloudfront_distribution" "frontend_distribution" {
  origin {
    domain_name              = aws_s3_bucket.frontend_bucket.bucket_regional_domain_name
    origin_id                = "S3-PeerPrepFrontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_oac.id
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  # Price Class 200 (Includes Singapore, Japan, Hong Kong, etc.)
  price_class = "PriceClass_200"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-PeerPrepFrontend"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  # SPA Routing: Redirect 403 and 404 errors to index.html
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "PeerPrepFrontendDistribution"
  }
}

# 5. S3 Bucket Policy to allow CloudFront OAC access
resource "aws_s3_bucket_policy" "frontend_bucket_policy" {
  bucket = aws_s3_bucket.frontend_bucket.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = "s3:GetObject"
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.frontend_bucket.arn}/*"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend_distribution.arn
          }
        }
      }
    ]
  })
}

# 6. Outputs
output "frontend_s3_bucket_name" {
  value       = aws_s3_bucket.frontend_bucket.id
  description = "The name of the S3 bucket hosting the frontend"
}

output "frontend_cloudfront_url" {
  value       = "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}"
  description = "The URL of the CloudFront distribution"
}

output "frontend_cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.frontend_distribution.id
  description = "The ID of the CloudFront distribution (used for invalidations)"
}
```

#### B. Execution
Run `terraform apply`. Once complete, take note of the `frontend_cloudfront_url` output. You will use this in the next step.

---

### Step 2.6: Backend Compute Deployments
This step provisions the actual computing resources for your 7 microservices. We use a hybrid approach: **AWS Lambda** for stateless services and **AWS ECS (on EC2)** for stateful services.

#### A. Application Load Balancer (`infrastructure/alb.tf`)
The ALB is our primary entry point for stateful traffic and sits in the **Public Subnets**.
*   **Path-Based Routing**: To minimize costs, we use a single ALB and route traffic based on URL paths (e.g., `/matching/*` and `/collab/*`) to different **Target Groups**.
*   **WebSocket Support**: We've ensured the listener supports long-lived TCP connections, which are critical for real-time synchronization in the Collaboration service.
*   **Health Check**: The Collaboration service health check targets `GET /collab/health` with `matcher = "200"`. A strict `200`-only matcher ensures the ALB only marks the service healthy when the Express server is fully initialised, not during startup or restart.

#### B. Lambda Services (`infrastructure/lambda.tf`)
Stateless services (User, Question, History, AI, and API Gateway) are deployed as Lambdas for maximum cost-efficiency, while ensuring future scalability by leveraging Lambda's native ability to scale to thousands of concurrent executions in seconds without manual server management.
*   **Elastic Scaling**: For every simultaneous request, Lambda automatically provisions a new "execution environment" (effectively a container). This means the system "increases containers" and load balances them for us on-the-fly.
*   **Concurrency Management**: In the highly unlikely event that traffic exceeds the default AWS regional concurrency limits, we can request a quota increase or implement **Provisioned Concurrency** to ensure immediate availability.
*   **Architectural Escape Hatch**: Because we have containerized these services using Docker, we retain the flexibility to move them to ECS (where we can manually scale container counts behind a load balancer) if our requirements ever exceed the Lambda execution model.
*   **Compartmentalized IAM**: Each service uses a dedicated execution role defined in this file, ensuring that permissions (like reading secrets) are isolated to only the services that need them.
*   **VPC Networking**: Lambdas are attached to **Private Subnets**, allowing them to talk to our internal Redis cache securely without exposing any endpoints to the public internet.
*   **Graviton (ARM64)**: We target the `arm64` architecture for Lambda to take advantage of Graviton2 processors, which offer better price-performance than standard x86 chips for our Python and Node.js runtimes.
*   **API Gateway Integration**: We use an AWS HTTP API to route traffic to our Lambdas. Here is the core configuration:
    ```hcl
    resource "aws_apigatewayv2_api" "http_api" {
      name          = "peerprep-api"
      protocol_type = "HTTP"
      cors_configuration {
        allow_origins = [
          var.frontend_url == "*" ? "*" : var.frontend_url,
          "http://localhost:5173"
        ]
        allow_methods = ["*"]
        # Explicit headers are required to prevent Cross-Origin Request Warning
        allow_headers = ["content-type", "authorization", "x-amz-date", "x-api-key", "x-amz-security-token"]
        max_age       = 300
      }
    }

    # Integration must use Payload 2.0 for FastAPI/Mangum compatibility
    resource "aws_apigatewayv2_integration" "gateway_integration" {
      api_id           = aws_apigatewayv2_api.http_api.id
      integration_type = "AWS_PROXY"
      integration_uri  = aws_lambda_function.api_gateway.invoke_arn
      payload_format_version = "2.0"
    }

    # Use $default route to capture all traffic correctly
    resource "aws_apigatewayv2_route" "catch_all" {
      api_id    = aws_apigatewayv2_api.http_api.id
      route_key = "$default"
      target    = "integrations/${aws_apigatewayv2_integration.gateway_integration.id}"
    }
    ```

*   **Function URL Permissions (The 403 Fix)**: When using Lambda Function URLs with `auth_type = "NONE"`, AWS requires **explicit** permissions for both `InvokeFunctionUrl` and `InvokeFunction` with a wildcard principal (`*`) for public access to work correctly. Without these, internal service-to-service calls via Function URLs will return a 403 Forbidden error.
    ```hcl
    resource "aws_lambda_permission" "allow_function_url" {
      statement_id           = "AllowFunctionUrlInvoke"
      action                 = "lambda:InvokeFunctionUrl"
      function_name          = aws_lambda_function.my_service.function_name
      principal              = "*"
      function_url_auth_type = "NONE"
    }
    ```

*   **ECR & Logging Permissions**: The Lambda execution role must include policies for CloudWatch Logs (`AWSLambdaBasicExecutionRole`) and specific ECR read permissions (`ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, etc.) to pull container images from private repositories.

#### C. ECS on EC2 (`infrastructure/ecs.tf`)
Stateful services (Matching, Collaboration) run as long-lived containers on a managed EC2 host.
*   **Cost Policy (Bin-Packing)**: Instead of using Fargate (which charges per-container), we use a single **t4g.small** EC2 instance. This allows us to run multiple containers on one "slice" of hardware, which is significantly cheaper for development.
*   **Task Isolation**: Even though they share a host, each service has its own **ECS Task Definition** and **Task Execution Role**, ensuring they remain logically separated.
*   **Future Scaling Strategy**:
    *   **Service Auto Scaling (Tasks)**: We can configure ECS to automatically increase the `desired_count` of our containers based on CPU/Memory usage or custom metrics (e.g., the length of the Matching queue).
    *   **Cluster Auto Scaling (Capacity Providers)**: Our current setup uses an ECS Capacity Provider linked to an Auto Scaling Group. If we increase our task count and the current EC2 instance runs out of CPU/RAM, AWS will automatically provision a second `t4g.small` instance to join the cluster.
    *   **Placement Strategies**: As we scale to multiple hosts, we can use **Spread** strategies to ensure that instances of the same service (e.g., Collaboration) are placed on different physical machines to prevent a single hardware failure from taking down the entire service.
*   **Centralized Logging**: Logs are streamed to CloudWatch, so you can monitor all your containers in one dashboard without ever needing to log into the EC2 instance itself.

#### D. Container Registry Integration (ECR)
All compute resources defined in this step (both Lambda and ECS) pull their runtime code from the ECR repositories created in Step 2.4. 
* **Lambda**: Each function is configured as a `PackageType = "Image"`. AWS pulls the image from ECR and caches it for execution.
* **ECS**: The Task Definitions specify the ECR Image URI. The EC2 host's Docker agent pulls these images from the private registry using the permissions granted by the Task Execution Role.
* **Immutable Tags**: While we use `:latest` for initial bootstrapping, our CI/CD pipeline (Step 3) uses unique commit SHAs to ensure deployments are traceable and rollbacks are reliable.

#### E. Execution
At this stage, your infrastructure code is complete. You have defined the networking (VPC), security (Secrets), caching (Redis), storage (ECR & S3), delivery (CloudFront), and compute (ALB, Lambda, ECS) layers. 

**This is the most critical point to run a final, comprehensive `terraform apply`.**

Running `terraform apply` now accomplishes the following:
1.  **Finalizes the Backbone**: It connects your compute resources (Lambda/ECS) to the VPC and Redis cluster.
2.  **Activates the Entry Points**: It provisions the Application Load Balancer (ALB) and the HTTP API Gateway, giving your backend its public-facing URLs.
3.  **Locks in the Environment**: It maps the CloudFront URL to the backend's CORS configuration and environment variables.

**What to Verify After Apply:**
*   **ALB DNS Name**: Check the Terraform output for the `alb_dns_name`. You should be able to reach the load balancer (though it may return a 503 until the ECS tasks are fully healthy).
*   **Lambda Console**: Verify that all 5 stateless services (API Gateway, User, Question, History, AI) appear in the AWS Lambda console with the correct "Image" package type.
*   **ECS Cluster**: In the ECS console, ensure the `peerprep-cluster` is active and that the `matching-service` and `collaboration-service` are attempting to start tasks on your EC2 instance.
*   **CloudFront URL**: Open the `frontend_cloudfront_url`. While the frontend assets aren't uploaded yet, you should see a CloudFront-branded 403 or 404 error, confirming the distribution is live.

**Transitioning to CI/CD:**
Once this manual "bootstrap" apply is successful and the infrastructure is "standing," you have a stable foundation. You are now ready to move away from manual commands and integrate **GitHub Actions** (Step 3) to handle the automated building, tagging, and deployment of your code updates.

---

## 3. Full CI/CD Automation (GitHub Actions)

We will automate the build-test-deploy lifecycle using GitHub Actions. To keep our pipelines maintainable and isolated, we use a **modular workflow strategy**. Instead of one giant file, we create small, focused workflows that trigger only when code in their specific directory changes.

### Step 3.1: GitHub Secrets Setup
Before creating workflows, you must store your AWS credentials and infrastructure endpoints securely. 
1.  Navigate to your GitHub Repository > **Settings** > **Secrets and variables** > **Actions**.
2.  Click **New repository secret** and add the following:
    *   `AWS_ACCESS_KEY_ID`: Your IAM user access key.
    *   `AWS_SECRET_ACCESS_KEY`: Your IAM user secret key.
    *   `AWS_REGION`: `ap-southeast-1`.
    *   `AWS_ACCOUNT_ID`: Your 12-digit AWS Account ID.
    *   `CLOUDFRONT_DISTRIBUTION_ID`: The ID from your `frontend.tf` output.
    *   `FRONTEND_URL`: The full `https://...` URL from your `frontend_cloudfront_url` output.
    *   `BACKEND_API_URL`: The URL for your stateless services (AWS HTTP API Gateway endpoint).
    *   `BACKEND_ALB_URL`: The DNS name for your stateful services (ALB DNS name).

### Step 3.2: The Lambda Pipeline (Stateless Services)
This template applies to: `api-gateway`, `user-service`, `question-service`, `history-service`, and `ai-service`.

**File:** `.github/workflows/deploy-question-service.yml`
```yaml
name: Deploy Question Service

on:
  push:
    branches: [ main ]
    paths: [ 'backend/question-service/**' ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, Tag, and Push Image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/peerprep/question-service:latest -t $ECR_REGISTRY/peerprep/question-service:$IMAGE_TAG ./backend/question-service
          docker push $ECR_REGISTRY/peerprep/question-service:latest
          docker push $ECR_REGISTRY/peerprep/question-service:$IMAGE_TAG

      - name: Update Lambda Function
        run: |
          aws lambda update-function-code \
            --function-name peerprep-question-service \
            --image-uri ${{ steps.login-ecr.outputs.registry }}/peerprep/question-service:${{ github.sha }}
```

### Step 3.3: The ECS Pipeline (Stateful Services)
This template applies to: `matching-service` and `collaboration-service`. Unlike Lambda, ECS requires updating a **Task Definition**.

**File:** `.github/workflows/deploy-collaboration-service.yml`
```yaml
# ... (Standard Checkout & ECR Login Steps as above)

      - name: Download Task Definition
        run: |
          aws ecs describe-task-definition --task-definition peerprep-collaboration-service --query taskDefinition > task-definition.json

      - name: Fill in the new image ID in the Amazon ECS task definition
        id: task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: task-definition.json
          container-name: collaboration-service
          image: ${{ steps.login-ecr.outputs.registry }}/peerprep/collaboration-service:${{ github.sha }}

      - name: Deploy Amazon ECS task definition
        uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: ${{ steps.task-def.outputs.task-definition }}
          service: peerprep-collaboration-service
          cluster: peerprep-cluster
          wait-for-service-stability: true
```

### Step 3.4: The Frontend Pipeline (S3 + CloudFront)
**File:** `.github/workflows/deploy-frontend.yml`
```yaml
name: Deploy Frontend

on:
  push:
    branches: [ main ]
    paths: [ 'frontend/**' ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Build Production Assets
        working-directory: frontend
        run: |
          npm install
          npm run build

      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Deploy to S3
        run: aws s3 sync frontend/dist s3://peerprep-frontend-${{ secrets.AWS_ACCOUNT_ID }} --delete

      - name: Invalidate CloudFront Cache
        run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} --paths "/*"
```

---

## 4. Bootstrapping Strategy (The "Final Push")

To ensure a smooth first-time deployment without "Circular Dependency" errors, follow this exact sequence:

1.  **Phase 1: Registry & Networking**: Run `terraform apply -target=module.vpc -target=aws_ecr_repository.service_repos`. This creates the "landing zones" for your code.
2.  **Phase 2: Bootstrap Images**: Run the `scripts/bootstrap_ecr.sh` (or `.ps1`) script. This pushes a `:latest` image for all 7 services so Terraform has a valid URI to reference.
3.  **Phase 3: Core Compute**: Run a full `terraform apply`. This provisions your Lambdas, ECS Cluster, ALB, and CloudFront.
4.  **Phase 4: Connect CI/CD**:
    *   Grab the CloudFront URL and ALB DNS name from the Terraform outputs.
    *   Add them to your GitHub Secrets.
    *   Push a small change (e.g., a comment) to each service to trigger the newly created GitHub Actions.
5.  **Validation**: Once the pipelines finish, visit your CloudFront URL. Your PeerPrep platform is now live and fully automated!
