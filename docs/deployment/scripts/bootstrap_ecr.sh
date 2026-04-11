#!/bin/bash

# PeerPrep ECR Bootstrap Script
# This script builds, tags, and pushes all 7 microservices to AWS ECR.

# Configuration - Update these or pass them as environment variables
AWS_ACCOUNT_ID=${1:-"YOUR_ACCOUNT_ID"}
REGION=${2:-"ap-southeast-1"}
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

SERVICES=(
  "api-gateway"
  "user-service"
  "question-service"
  "history-service"
  "ai-service"
  "matching-service"
  "collaboration-service"
)

# Get the directory where the script is located to handle relative paths correctly
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "Starting ECR Bootstrap for account ${AWS_ACCOUNT_ID} in region ${REGION}..."

# Authenticate Docker to ECR
aws ecr get-login-password --region "${REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

if [ $? -ne 0 ]; then
  echo "Error: Docker authentication to ECR failed. Check your AWS credentials and region."
  exit 1
fi

for SERVICE in "${SERVICES[@]}"; do
  echo "--------------------------------------------------------"
  echo "Processing service: ${SERVICE}"
  echo "--------------------------------------------------------"

  # Path to the service directory relative to project root
  SERVICE_PATH="$PROJECT_ROOT/backend/${SERVICE}"
  
  if [ ! -d "${SERVICE_PATH}" ]; then
    echo "Warning: Directory ${SERVICE_PATH} not found. Skipping..."
    continue
  fi

  # 1. Build
  echo "Building Docker image for ${SERVICE}..."
  docker build -t "peerprep/${SERVICE}:latest" "${SERVICE_PATH}"
  
  if [ $? -ne 0 ]; then
    echo "Error: Build failed for ${SERVICE}. Stopping script."
    exit 1
  fi

  # 2. Tag
  echo "Tagging image..."
  docker tag "peerprep/${SERVICE}:latest" "${ECR_REGISTRY}/peerprep/${SERVICE}:latest"

  # 3. Push
  echo "Pushing image to ECR..."
  docker push "${ECR_REGISTRY}/peerprep/${SERVICE}:latest"

  if [ $? -ne 0 ]; then
    echo "Error: Push failed for ${SERVICE}. Stopping script."
    exit 1
  fi

  echo "Successfully pushed ${SERVICE} to ECR."
done

echo "--------------------------------------------------------"
echo "Bootstrap complete! All services pushed to ECR."
echo "--------------------------------------------------------"
