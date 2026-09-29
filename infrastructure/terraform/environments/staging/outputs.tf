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
  description = "Set as the AWS_DEPLOY_ROLE_ARN variable of the GitHub 'staging' environment"
  value       = module.cicd.deploy_role_arn
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "task_security_group_id" {
  value = module.compute.task_security_group_id
}
