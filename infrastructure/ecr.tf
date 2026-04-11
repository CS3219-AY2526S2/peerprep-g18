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