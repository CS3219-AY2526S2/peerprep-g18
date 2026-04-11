# 1. IAM Role for ECS Task Execution (Used by ECS to pull images and read secrets)
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "peerprep-ecs-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "ecs_task_secrets_read" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.secrets_read_policy.arn
}

# 1.1. Additional permissions for ECS Task Execution (Logging)
resource "aws_iam_policy" "ecs_logging_policy" {
  name        = "PeerPrepECSLoggingPolicy"
  description = "Allows ECS tasks to create log groups and streams"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = "logs:CreateLogGroup"
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_logging_attach" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.ecs_logging_policy.arn
}

# 2. IAM Role for ECS EC2 Instance (The host machine)
resource "aws_iam_role" "ecs_instance_role" {
  name = "peerprep-ecs-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_instance_role_policy" {
  role       = aws_iam_role.ecs_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_instance_profile" "ecs_instance_profile" {
  name = "peerprep-ecs-instance-profile"
  role = aws_iam_role.ecs_instance_role.name
}

# 3. Security Group for ECS Nodes (EC2 Host)
resource "aws_security_group" "ecs_node_sg" {
  name        = "peerprep-ecs-node-sg"
  description = "Allow traffic from ALB to ECS nodes"
  vpc_id      = module.vpc.vpc_id

  # Allow inbound traffic from ALB on all ephemeral ports
  ingress {
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 4. Get the latest ECS-optimized AMI for ARM64 (Graviton)
data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/arm64/recommended/image_id"
}

# 5. ECS Cluster
resource "aws_ecs_cluster" "main" {
  name = "peerprep-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# 6. EC2 Launch Template (t4g.small host)
resource "aws_launch_template" "ecs_host" {
  name_prefix   = "peerprep-ecs-host-"
  image_id      = data.aws_ssm_parameter.ecs_ami.value
  instance_type = "t4g.small" # Cost-effective Graviton2 instance

  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance_profile.name
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.ecs_node_sg.id]
  }

  user_data = base64encode(<<-EOF
              #!/bin/bash
              echo ECS_CLUSTER=${aws_ecs_cluster.main.name} >> /etc/ecs/ecs.config
              EOF
  )
}

# 7. Auto Scaling Group (Single node for dev)
resource "aws_autoscaling_group" "ecs_asg" {
  name                = "peerprep-ecs-asg"
  vpc_zone_identifier = module.vpc.private_subnets
  min_size            = 1
  max_size            = 1
  desired_capacity    = 1

  launch_template {
    id      = aws_launch_template.ecs_host.id
    version = "$Latest"
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = true
    propagate_at_launch = true
  }
}

# 8. ECS Capacity Provider
resource "aws_ecs_capacity_provider" "main" {
  name = "peerprep-capacity-provider"

  auto_scaling_group_provider {
    auto_scaling_group_arn = aws_autoscaling_group.ecs_asg.arn
    managed_termination_protection = "DISABLED"

    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 100
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 1
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name
  capacity_providers = [aws_ecs_capacity_provider.main.name]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = aws_ecs_capacity_provider.main.name
  }
}

# 9. ECS Task Definitions & Services (Matching & Collaboration)
locals {
  ecs_services = {
    "matching-service"      = { port = 8001, cpu = 256, memory = 512 }
    "collaboration-service" = { port = 3001, cpu = 256, memory = 512 }
  }
}

# Explicitly create log groups to avoid race conditions and permission issues
resource "aws_cloudwatch_log_group" "ecs_logs" {
  for_each          = local.ecs_services
  name              = "/ecs/peerprep-${each.key}"
  retention_in_days = 7 # Keep logs for 7 days for dev
}

resource "aws_ecs_task_definition" "services" {
  for_each                 = local.ecs_services
  family                   = "peerprep-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["EC2"]
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.service_repos[each.key].repository_url}:latest"
    essential = true
    portMappings = [{
      containerPort = each.value.port
      hostPort      = each.value.port
      protocol      = "tcp"
    }]
    environment = [
      { name = "REDIS_HOST", value = aws_elasticache_cluster.redis.cache_nodes[0].address },
      { name = "REDIS_PORT", value = "6379" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/peerprep-${each.key}"
        "awslogs-region"        = "ap-southeast-1"
        "awslogs-stream-prefix" = "ecs"
        "awslogs-create-group"  = "true"
      }
    }
  }])
}

resource "aws_ecs_service" "services" {
  for_each        = local.ecs_services
  name            = "peerprep-${each.key}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.services[each.key].arn
  desired_count   = 1
  launch_type     = "EC2"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs_node_sg.id]
  }

  load_balancer {
    target_group_arn = (each.key == "matching-service" ? aws_lb_target_group.matching_tg.arn : aws_lb_target_group.collaboration_tg.arn)
    container_name   = each.key
    container_port   = each.value.port
  }

  lifecycle {
    ignore_changes = [task_definition] # Let CI/CD manage the task definition updates
  }
}
