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