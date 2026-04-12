# 1. IAM Role for Lambda Execution
resource "aws_iam_role" "lambda_exec_role" {
  name = "peerprep-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

# Attach basic Lambda VPC execution policy (for logging and networking)
resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Attach our custom Secrets Manager read policy
resource "aws_iam_role_policy_attachment" "lambda_secrets_read" {
  role       = aws_iam_role.lambda_exec_role.name
  policy_arn = aws_iam_policy.secrets_read_policy.arn
}

# 2. Security Group for Lambdas
resource "aws_security_group" "lambda_sg" {
  name        = "peerprep-lambda-sg"
  description = "Allow Lambdas to reach Redis and Outbound"
  vpc_id      = module.vpc.vpc_id

  # No inbound traffic (Lambdas are triggered by API GW)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 3. API Gateway (HTTP API Type)
resource "aws_apigatewayv2_api" "http_api" {
  name          = "peerprep-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = [
      var.frontend_url == "*" ? "*" : var.frontend_url,
      "http://localhost:5173"
    ]
    allow_methods = ["*"]
    allow_headers = ["*"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
}

# 4. Lambda Functions for Microservices
locals {
  lambda_services = {
    "api-gateway"      = { port = 8000 }
    "user-service"     = { port = 8002 }
    "question-service" = { port = 8003 }
    "history-service"  = { port = 8004 }
    "ai-service"       = { port = 8005 }
  }
}

resource "aws_lambda_function" "services" {
  for_each      = local.lambda_services
  function_name = "peerprep-${each.key}"
  role          = aws_iam_role.lambda_exec_role.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.service_repos[each.key].repository_url}:latest"
  timeout       = 30
  memory_size   = 512

  vpc_config {
    subnet_ids         = module.vpc.private_subnets
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      REDIS_SESSIONS_HOST  = aws_elasticache_cluster.redis.cache_nodes[0].address
      REDIS_AUTH_HOST      = aws_elasticache_cluster.redis.cache_nodes[0].address
      FRONTEND_URL         = "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}"
      USER_SERVICE_URL     = aws_lambda_function_url.service_urls["user-service"].function_url
      QUESTION_SERVICE_URL = aws_lambda_function_url.service_urls["question-service"].function_url
      HISTORY_SERVICE_URL  = aws_lambda_function_url.service_urls["history-service"].function_url
      AI_SERVICE_URL       = aws_lambda_function_url.service_urls["ai-service"].function_url
      MATCHING_SERVICE_URL = "http://${aws_lb.main_alb.dns_name}"
      COLLAB_SERVICE_URL   = "http://${aws_lb.main_alb.dns_name}"
    }
  }

  lifecycle {
    ignore_changes = [image_uri, environment]
  }
}

# Function URLs for internal microservice communication
resource "aws_lambda_function_url" "service_urls" {
  for_each           = local.lambda_services
  function_name      = aws_lambda_function.services[each.key].function_name
  authorization_type = "NONE" # Simple for now; secure with IAM in prod
}

# API Gateway Integration for the API Gateway Lambda (Entry point)
resource "aws_apigatewayv2_integration" "gateway_integration" {
  api_id             = aws_apigatewayv2_api.http_api.id
  integration_type   = "AWS_PROXY"
  integration_method = "POST"
  integration_uri    = aws_lambda_function.services["api-gateway"].invoke_arn
}

# Route EVERYTHING to the API Gateway Lambda
resource "aws_apigatewayv2_route" "catch_all" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.gateway_integration.id}"
}

# Allow API Gateway to invoke the Gateway Lambda
resource "aws_lambda_permission" "api_gw_to_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.services["api-gateway"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

# 5. Output API Gateway URL
output "api_gateway_url" {
  value = aws_apigatewayv2_api.http_api.api_endpoint
}
