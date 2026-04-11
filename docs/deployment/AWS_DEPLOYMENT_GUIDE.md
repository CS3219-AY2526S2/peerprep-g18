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

### Step 2.1: Base Networking (VPC & Subnets)
This step builds the networking backbone in the **Singapore (`ap-southeast-1`)** region. We use 2 Availability Zones (AZs) for high availability.

#### A. Folder Structure
Create an `infrastructure/` directory at the project root to house your Terraform files.

#### B. Provider Configuration (`infrastructure/provider.tf`)
Tells Terraform to use the AWS provider and target the correct region.
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
  region = "ap-southeast-1"
}
```

#### C. VPC Definition (`infrastructure/vpc.tf`)
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

#### D. Execution
Run these commands in the `infrastructure/` directory to build your network foundation:
1.  **`terraform init`**: **Prepares the environment.** It downloads the necessary AWS plugins (providers) and the community VPC module defined in your code.
2.  **`terraform plan`**: **The "Safety Check".** This compares your code against what is actually in AWS and shows you a line-by-line preview of the VPC, Subnets, and NAT Gateway to be created. **It makes no changes to AWS yet.**
3.  **`terraform apply`**: **The "Action Step".** After reviewing the plan, this command sends the instructions to AWS to build your network. You will be asked to type `yes` to confirm.

### Step 2.2: Secrets Management (Firebase & Environment Variables)
To avoid hardcoding sensitive information like Firebase Service Account JSONs or SMTP passwords, we use **AWS Secrets Manager**. 

#### A. Secrets Definition (`infrastructure/secrets.tf`)
Create "containers" for your secrets. We create three for the different Firebase projects and one for general Backend environment variables.

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
Run these commands in the `infrastructure/` directory to build your secrets vault:
1.  **`terraform plan`**: **The Safety Check.** This verifies that your IAM policy syntax is correct and previews the creation of your two secret containers.
2.  **`terraform apply`**: **The Action Step.** This provisions the secret entries in AWS Secrets Manager. Note: The secrets will be empty until you perform the manual step below.

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

#### B. Execution
Run these commands in the `infrastructure/` directory to build your cache engine:
1.  **`terraform plan`**: **The Safety Check.** This verifies the security group rules and previews the creation of the Redis cluster and its subnet group.
2.  **`terraform apply`**: **The Action Step.** This provisions the Redis node. Note: Redis can take 5-10 minutes to become "Available" in the AWS Console.

### Step 2.4: Elastic Container Registry (ECR)
Before we can deploy our services, we need a place to store our Docker images. We use **Amazon ECR**, a fully managed Docker container registry. We will create one private repository for each of our 7 microservices.

#### A. Repository Configuration (`infrastructure/ecr.tf`)
We use a `for_each` loop to cleanly create all repositories at once and attach a **Lifecycle Policy** to each. This policy automatically deletes old images (keeping only the last 5), which is crucial for controlling storage costs in a development environment.

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
      description  = "Keep only the last 5 images to save on storage costs"
      selection = {
        tagStatus     = "any"
        countType     = "imageCountMoreThan"
        countNumber   = 5
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
3.  Click on any repository and check the **Lifecycle policy** tab to ensure the "Keep last 5 images" rule is active.

### Step 2.5: Backend Compute Deployments
This step provisions the actual computing resources for your 7 microservices. We use a hybrid approach: **AWS Lambda** for stateless services and **AWS ECS (on EC2)** for stateful services.

#### A. Application Load Balancer (`infrastructure/alb.tf`)
The ALB is our primary entry point for stateful traffic and sits in the **Public Subnets**.
*   **Path-Based Routing**: To minimize costs, we use a single ALB and route traffic based on URL paths (e.g., `/matching/*` and `/collaboration/*`) to different **Target Groups**.
*   **WebSocket Support**: We've ensured the listener supports long-lived TCP connections, which are critical for real-time synchronization in the Collaboration service.

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
        allow_origins = ["*"] # Adjust this later for security
        allow_methods = ["*"]
        allow_headers = ["*"]
      }
    }
    ```
    > **Note on CORS Security**: We are currently allowing all origins (`*`) to prevent blocking the frontend during initial setup. Since the CloudFront URL (the "Frontend address") is generated later in the process, we use this permissive setting to ensure connectivity. We will restrict this to the specific CloudFront domain once it is provisioned.

#### C. ECS on EC2 (`infrastructure/ecs.tf`)
Stateful services (Matching, Collaboration) run as long-lived containers on a managed EC2 host.
*   **Cost Policy (Bin-Packing)**: Instead of using Fargate (which charges per-container), we use a single **t4g.small** EC2 instance. This allows us to run multiple containers on one "slice" of hardware, which is significantly cheaper for development.
*   **Task Isolation**: Even though they share a host, each service has its own **ECS Task Definition** and **Task Execution Role**, ensuring they remain logically separated.
*   **Future Scaling Strategy**:
    *   **Service Auto Scaling (Tasks)**: We can configure ECS to automatically increase the `desired_count` of our containers based on CPU/Memory usage or custom metrics (e.g., the length of the Matching queue).
    *   **Cluster Auto Scaling (Capacity Providers)**: Our current setup uses an ECS Capacity Provider linked to an Auto Scaling Group. If we increase our task count and the current EC2 instance runs out of CPU/RAM, AWS will automatically provision a second `t4g.small` instance to join the cluster.
    *   **Placement Strategies**: As we scale to multiple hosts, we can use **Spread** strategies to ensure that instances of the same service (e.g., Collaboration) are placed on different physical machines to prevent a single hardware failure from taking down the entire service.
*   **Centralized Logging**: Logs are streamed to CloudWatch, so you can monitor all your containers in one dashboard without ever needing to log into the EC2 instance itself.

#### E. Execution
1.  **`terraform plan`**: Review the creation of IAM roles, the ALB, 5 Lambda functions, and the ECS cluster.
2.  **`terraform apply`**: Provision the compute layer.
    - *Note*: You must have pushed at least one image to each ECR repository before this will succeed (see Step 4).

### Step 2.6: Frontend (S3 + CloudFront)
*   **S3 Bucket:** Hosts the compiled React build (`dist/`). Configured to block all public access.
*   **CloudFront Distribution:** Acts as a CDN. Uses **Origin Access Control (OAC)** to securely read files from the S3 bucket and serve them globally over HTTPS via an AWS CloudFront URL (e.g., `https://d12345.cloudfront.net`).

---

## 3. Full CI/CD Automation (GitHub Actions)

We will fully automate the deployment using GitHub Actions. Whenever code is pushed to the `main` branch, the pipeline will build Docker images, push them to ECR, and update the respective AWS services.

### Prerequisites
Add these secrets to your GitHub Repository (`Settings > Secrets and variables > Actions`):
*   `AWS_ACCESS_KEY_ID`
*   `AWS_SECRET_ACCESS_KEY`
*   `AWS_REGION` (e.g., `ap-southeast-1`)

### 3.1 Pipeline Workflows (`.github/workflows/`)

To keep deployments fast and isolated, create a separate workflow file for each component.

#### Example 1: Lambda Service Pipeline (`question-service.yml`)
1.  **Trigger:** On push to `main` with changes in `backend/question-service/**`.
2.  **Steps:**
    *   Checkout code & Configure AWS credentials.
    *   Login to Amazon ECR.
    *   Build the Docker image and push to ECR with a unique tag (e.g., the commit SHA).
    *   Deploy: Run an AWS CLI command to force the Lambda function to use the newly pushed image:
        `aws lambda update-function-code --function-name question-service --image-uri <ECR_URI>:<TAG>`

#### Example 2: ECS Pipeline (`collaboration-service.yml`)
1.  **Trigger:** On push to `main` with changes in `backend/collaboration-service/**`.
2.  **Steps:**
    *   Checkout code & Configure AWS credentials.
    *   Login to Amazon ECR.
    *   Build and push Docker image.
    *   Use the `aws-actions/amazon-ecs-render-task-definition` action to insert the new image ID into the ECS Task Definition JSON.
    *   Use the `aws-actions/amazon-ecs-deploy-task-definition` action to seamlessly deploy the new task to the ECS Cluster (handling zero-downtime rolling updates automatically).

#### Example 3: Frontend Pipeline (`frontend.yml`)
1.  **Trigger:** On push to `main` with changes in `frontend/**`.
2.  **Steps:**
    *   Checkout code & Setup Node.js.
    *   Inject AWS URLs into the `.env` file at build time.
    *   Run `npm install` and `npm run build`.
    *   Configure AWS credentials.
    *   Deploy: Sync the `dist/` folder to the S3 bucket:
        `aws s3 sync ./dist s3://peerprep-frontend-bucket --delete`
    *   Cache Invalidation: Force CloudFront to serve the latest version immediately:
        `aws cloudfront create-invalidation --distribution-id $CF_DIST_ID --paths "/*"`

---

## 4. Bootstrapping Strategy (The "Chicken and Egg" Problem)

Terraform cannot deploy Lambda or ECS if the ECR repositories are empty because the "image" parameter is mandatory.

### Phase 1: Registry & Networking
Run Terraform code to deploy ONLY the VPC and ECR repositories.
```bash
terraform apply -target=module.vpc -target=aws_ecr_repository.service_repos
```

### Phase 2: Initial Image Push
1.  Build and push your Docker images manually (or via a temporary GitHub Action) to the 7 new ECR repositories. 
2.  Ensure each repository has at least one image tagged `:latest`.

### Phase 3: Full Infrastructure
Now that images exist, run a full `terraform apply` to deploy Lambda, ECS, ALB, and CloudFront.
```bash
terraform apply
```

### Phase 4: Environment Variables Loop
1.  Retrieve the generated AWS URLs (CloudFront, ALB, API Gateway).
2.  Add these as GitHub Secrets so the CI/CD pipelines can build the `.env` files.
3.  Trigger the pipelines one last time so services are aware of each other.
