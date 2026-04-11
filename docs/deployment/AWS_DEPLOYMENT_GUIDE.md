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
2.  Install the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and configure it (`aws configure`).

### Step 2.1: Base Networking (VPC & Subnets)
Using the official `terraform-aws-modules/vpc/aws` module, we define a VPC with 2 Public Subnets and 2 Private Subnets. We enable a NAT Gateway so the Private Subnets can talk to Firestore.

### Step 2.2: Secrets Management
We define secrets in AWS Secrets Manager via Terraform (e.g., `peerprep/firebase-service-account`). Terraform also provisions **IAM Execution Roles** for Lambda and ECS, specifically granting them `secretsmanager:GetSecretValue` permissions so they can inject credentials at startup.

### Step 2.3: ElastiCache (Redis)
*   **Placement:** Deployed inside the **Private Subnets**.
*   **Security Group Rules:** Only allows Inbound TCP on port `6379` from the specific Security Groups tied to ECS (Matching/Collaboration) and Lambda (Gateway/User/Question/etc).

### Step 2.4: Elastic Container Registry (ECR)
Terraform will provision private ECR repositories to store Docker images for every single service:
`peerprep/api-gateway`, `peerprep/user-service`, `peerprep/question-service`, `peerprep/history-service`, `peerprep/ai-service`, `peerprep/matching-service`, `peerprep/collaboration-service`.

### Step 2.5: Serverless Compute Deployments

#### A. AWS Lambda (Container Images)
**Services:** API Gateway, User, Question, History, AI
*   **Rationale:** Following the deprecation of AWS App Runner (slated for late April 2026), all stateless microservices have been migrated to AWS Lambda for better cost-efficiency and simplified management.
*   **Packaging:** Packaged as Docker containers and pushed to ECR.
*   **Terraform Config:** Defines Lambda functions referencing the ECR images. Attached to the Private Subnets so they can securely access Redis (if needed).
*   **Networking:** An API Gateway (HTTP API type) is provisioned to trigger the Lambdas, providing default AWS URLs (e.g., `https://xyz.execute-api.ap-southeast-1.amazonaws.com`).

#### B. AWS ECS
**Services:** Matching Service, Collaboration Service
*   **Rationale:** Matching and Collaboration require persistent connections (SSE and WebSockets) and long-lived state that are not suitable for Lambda's execution limits.
*   **Packaging:** Runs as long-lived containers in ECS clusters pulling from ECR.
*   **Networking:** Deployed strictly in Private Subnets. Exposed to the internet via an **Application Load Balancer (ALB)** sitting in the Public Subnets.
*   **ALB Config:** Configured to support WebSockets (ws/wss) required by the Collaboration service (Yjs/Socket.io), providing an AWS-generated URL (e.g., `peerprep-alb-123.ap-southeast-1.elb.amazonaws.com`).

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

When setting this up for the very first time, Terraform cannot deploy Lambda or ECS if the ECR repositories are empty. Follow this execution order:

1.  **Upload Secrets:** Manually create the Secrets Manager entries for Firebase via the AWS Console.
2.  **Phase 1 Terraform:** Write and run Terraform code to *only* deploy the VPC, Subnets, Security Groups, and empty ECR Repositories.
    ```bash
    terraform apply -target=module.vpc -target=aws_ecr_repository.services
    ```
3.  **Phase 1 CI/CD:** Run your GitHub Actions manually (or push code) to build your Docker images and push them into the newly created ECR repositories.
4.  **Phase 2 Terraform:** Now that images exist, run a full `terraform apply` to deploy Lambda, ECS, ElastiCache, S3, and CloudFront.
5.  **Environment Variables Loop:**
    *   Retrieve the generated AWS URLs (CloudFront, ALB, API Gateway HTTP APIs).
    *   Add these URLs as GitHub Repository Secrets so the Frontend and API Gateway CI/CD pipelines can build the `.env` files.
    *   Trigger the CI/CD pipelines one final time so the services become aware of each other's AWS URLs.
