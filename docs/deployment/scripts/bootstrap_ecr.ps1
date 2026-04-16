# PeerPrep ECR Bootstrap Script (PowerShell)
# This script builds, tags, and pushes all 7 microservices to AWS ECR.

param (
    [string]$AWS_ACCOUNT_ID = "YOUR_ACCOUNT_ID",
    [string]$REGION = "ap-southeast-1"
)

$ECR_REGISTRY = "$($AWS_ACCOUNT_ID.Trim()).dkr.ecr.$($REGION.Trim()).amazonaws.com"

$SERVICES = @(
    "api-gateway",
    "user-service",
    "question-service",
    "history-service",
    "ai-service",
    "matching-service",
    "collaboration-service"
)

# Get project root based on script location
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_ROOT = Resolve-Path "$SCRIPT_DIR/../../.."

Write-Host "Starting ECR Bootstrap for account $AWS_ACCOUNT_ID in region $REGION..." -ForegroundColor Cyan

# Authenticate Docker to ECR
Write-Host "Authenticating Docker to ECR..." -ForegroundColor Yellow
cmd /c "aws ecr get-login-password --region $($REGION.Trim()) | docker login --username AWS --password-stdin $ECR_REGISTRY"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker authentication to ECR failed. Check your AWS credentials and region." -ForegroundColor Red
    exit 1
}

foreach ($SERVICE in $SERVICES) {
    Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "Processing service: $SERVICE" -ForegroundColor Cyan
    Write-Host "--------------------------------------------------------" -ForegroundColor Cyan

    # Path to the service directory
    $SERVICE_PATH = "$PROJECT_ROOT/backend/$SERVICE"
    
    if (-not (Test-Path $SERVICE_PATH)) {
        Write-Warning "Directory $SERVICE_PATH not found. Skipping..."
        continue
    }

    # 1. Build
    Write-Host "Building Docker image for $SERVICE..." -ForegroundColor Yellow
    docker build -t "peerprep/${SERVICE}:latest" $SERVICE_PATH
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Build failed for $SERVICE. Stopping script." -ForegroundColor Red
        exit 1
    }

    # 2. Tag
    Write-Host "Tagging image..." -ForegroundColor Yellow
    docker tag "peerprep/${SERVICE}:latest" "${ECR_REGISTRY}/peerprep/${SERVICE}:latest"

    # 3. Push
    Write-Host "Pushing image to ECR..." -ForegroundColor Yellow
    docker push "${ECR_REGISTRY}/peerprep/${SERVICE}:latest"

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Push failed for $SERVICE. Stopping script." -ForegroundColor Red
        exit 1
    }

    Write-Host "Successfully pushed $SERVICE to ECR." -ForegroundColor Green
}

Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Bootstrap complete! All services pushed to ECR." -ForegroundColor Green
Write-Host "--------------------------------------------------------" -ForegroundColor Cyan
