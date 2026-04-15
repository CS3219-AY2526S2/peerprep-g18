# --- Step 2.2.A: Secrets Definition ---
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

# --- STEP 2.2.B: IAM Access Policy ---
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