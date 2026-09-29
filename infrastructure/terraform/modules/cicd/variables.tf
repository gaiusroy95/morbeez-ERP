variable "name" {
  type = string
}

variable "github_repository" {
  description = "owner/repo"
  type        = string
}

variable "github_environment" {
  description = "GitHub environment whose jobs may assume the deploy role (production, staging)"
  type        = string
}

variable "create_oidc_provider" {
  description = "The GitHub OIDC provider is one per AWS account; create it in exactly one environment per account"
  type        = bool
  default     = true
}

variable "cluster_name" {
  type = string
}

variable "ecr_repository_arns" {
  type = list(string)
}

variable "task_role_arns" {
  type = list(string)
}

variable "database_instance_id" {
  type = string
}

variable "database_kms_key_arn" {
  type = string
}

variable "database_owner_url_secret_arn" {
  type = string
}
