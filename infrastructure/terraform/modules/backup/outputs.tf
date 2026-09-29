output "vault_name" {
  value = aws_backup_vault.primary.name
}

output "dr_vault_name" {
  value = aws_backup_vault.dr.name
}
