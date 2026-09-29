output "instance_id" {
  value = aws_db_instance.this.identifier
}

output "instance_arn" {
  value = aws_db_instance.this.arn
}

output "address" {
  value = aws_db_instance.this.address
}

output "kms_key_arn" {
  value = aws_kms_key.db.arn
}

output "owner_url_secret_arn" {
  value = aws_secretsmanager_secret.owner_url.arn
}

output "app_url_secret_arn" {
  value = aws_secretsmanager_secret.app_url.arn
}

output "app_password_secret_arn" {
  value = aws_secretsmanager_secret.app_password.arn
}

output "security_group_id" {
  value = aws_security_group.db.id
}
