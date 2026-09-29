output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "alb_arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "api_target_group_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}

output "web_target_group_arn_suffix" {
  value = aws_lb_target_group.web.arn_suffix
}

output "ecr_repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "ecr_repository_arns" {
  value = [for r in aws_ecr_repository.this : r.arn]
}

output "task_role_arns" {
  description = "Roles the pipeline passes when registering task definitions"
  value       = [aws_iam_role.execution.arn, aws_iam_role.api_task.arn, aws_iam_role.plain_task.arn]
}

output "log_group_names" {
  value = { for k, g in aws_cloudwatch_log_group.app : k => g.name }
}

output "api_url" {
  value = "https://api.${var.domain_name}"
}

output "web_url" {
  value = "https://app.${var.domain_name}"
}

output "waf_name" {
  value = aws_wafv2_web_acl.this.name
}
