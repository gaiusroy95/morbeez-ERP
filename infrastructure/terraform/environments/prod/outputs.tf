output "web_url" {
  value = module.compute.web_url
}

output "api_url" {
  value = module.compute.api_url
}

output "ecr_repositories" {
  value = module.compute.ecr_repository_urls
}

output "cluster_name" {
  value = module.compute.cluster_name
}

output "deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN variable of the GitHub 'production' environment"
  value       = module.cicd.deploy_role_arn
}

output "drill_role_arn" {
  description = "Set as the AWS_DRILL_ROLE_ARN variable of the GitHub 'production-drill' environment"
  value       = module.cicd.drill_role_arn
}

output "private_subnet_ids" {
  description = "Where the migration and drill tasks run"
  value       = module.network.private_subnet_ids
}

output "task_security_group_id" {
  value = module.compute.task_security_group_id
}

output "database_instance_id" {
  value = module.database.instance_id
}

output "dashboard" {
  value = module.observability.dashboard_name
}

output "database_security_group_id" {
  description = "DB_SECURITY_GROUP for the restore drill's GitHub environment"
  value       = module.database.security_group_id
}
