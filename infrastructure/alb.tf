# 1. Security Group for Application Load Balancer
resource "aws_security_group" "alb_sg" {
  name        = "peerprep-alb-sg"
  description = "Allow inbound HTTP traffic to ALB"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 2. Application Load Balancer (sitting in Public Subnets)
resource "aws_lb" "main_alb" {
  name               = "peerprep-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = module.vpc.public_subnets

  tags = {
    Name = "PeerPrepALB"
  }
}

# 3. Target Group for Matching Service
resource "aws_lb_target_group" "matching_tg" {
  name        = "matching-tg"
  port        = 8001
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

# 4. Target Group for Collaboration Service (supports WebSockets)
resource "aws_lb_target_group" "collaboration_tg" {
  name        = "collaboration-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"

  health_check {
    path                = "/collab/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
    matcher             = "200,404"
  }
}

# 5. ALB Listener (HTTP)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "PeerPrep ALB - Use /matching or /collab paths"
      status_code  = "200"
    }
  }
}

# 6. Listener Rule for Matching Service
resource "aws_lb_listener_rule" "matching_rule" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.matching_tg.arn
  }

  condition {
    path_pattern {
      values = ["/matching/*"]
    }
  }
}

# 7. Listener Rule for Collaboration Service
resource "aws_lb_listener_rule" "collaboration_rule" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 200

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.collaboration_tg.arn
  }

  condition {
    path_pattern {
      values = ["/collab/*", "/socket.io/*"]
    }
  }
}

# 8. Output ALB DNS Name
output "alb_dns_name" {
  value = aws_lb.main_alb.dns_name
}
