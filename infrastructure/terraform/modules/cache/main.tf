# Redis on ElastiCache (Technology Stack §05): rate-limit counters (shared
# across API tasks — Security Audit SA-02) and cache. A primary and a replica
# in different AZs with automatic failover, TLS in transit and encryption at
# rest, an auth token held in Secrets Manager. Nothing here is the only copy
# of any business data, so there is no backup beyond a daily snapshot.

terraform {
  required_providers {
    aws    = { source = "hashicorp/aws" }
    random = { source = "hashicorp/random" }
  }
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
  name        = "${var.name}-redis"
  description = "Redis - from the application tasks only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-redis" }
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_app" {
  for_each                     = toset(var.client_security_group_ids)
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "Redis from application tasks"
}

resource "random_password" "auth" {
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "${var.name} rate limits and cache"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.node_type
  num_cache_clusters         = var.replicas + 1
  automatic_failover_enabled = var.replicas > 0
  multi_az_enabled           = var.replicas > 0
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.redis.id]
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  auth_token                 = random_password.auth.result
  snapshot_retention_limit   = 1
  snapshot_window            = "21:30-22:30"
  maintenance_window         = "sun:22:30-sun:23:30"
  auto_minor_version_upgrade = true
  apply_immediately          = false
}

resource "aws_secretsmanager_secret" "url" {
  name                    = "${var.name}/redis-url"
  description             = "Redis connection string (TLS, with auth token) - the API"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "url" {
  secret_id     = aws_secretsmanager_secret.url.id
  secret_string = "rediss://:${random_password.auth.result}@${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
  # Rotated by hand (runbooks/secret-rotation.md); Terraform only creates it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
