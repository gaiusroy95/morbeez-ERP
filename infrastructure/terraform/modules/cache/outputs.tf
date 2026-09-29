output "url_secret_arn" {
  value = aws_secretsmanager_secret.url.arn
}

output "replication_group_id" {
  value = aws_elasticache_replication_group.this.id
}

output "security_group_id" {
  value = aws_security_group.redis.id
}
