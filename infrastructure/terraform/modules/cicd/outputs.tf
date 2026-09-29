output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

output "drill_role_arn" {
  value = aws_iam_role.drill.arn
}
