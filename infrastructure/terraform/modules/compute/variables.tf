variable "name" {
  type = string
}

variable "domain_name" {
  description = "Apex domain; the owner app is app.<domain>, the API api.<domain>"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone for domain_name"
  type        = string
}

variable "image_tag" {
  description = "Image tag (a commit SHA) for the first deploy; the pipeline owns it afterwards"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "logs_bucket" {
  type = string
}

variable "uploads_bucket" {
  type = string
}

variable "uploads_bucket_arn" {
  type = string
}

variable "uploads_kms_key_arn" {
  type = string
}

variable "database_app_url_secret_arn" {
  type = string
}

variable "database_owner_url_secret_arn" {
  type = string
}

variable "database_app_password_secret_arn" {
  type = string
}

variable "database_kms_key_arn" {
  type = string
}

variable "redis_url_secret_arn" {
  type = string
}

variable "api_cpu" {
  type    = number
  default = 1024
}

variable "api_memory" {
  type    = number
  default = 2048
}

variable "api_min_tasks" {
  description = "At least one per AZ in production"
  type        = number
  default     = 3
}

variable "api_rush_min_tasks" {
  description = "Floor during the 04:00-08:00 IST dispatch rush"
  type        = number
  default     = 6
}

variable "api_max_tasks" {
  type    = number
  default = 20
}

variable "api_requests_per_task_per_minute" {
  type    = number
  default = 600
}

variable "web_cpu" {
  type    = number
  default = 512
}

variable "web_memory" {
  type    = number
  default = 1024
}

variable "web_min_tasks" {
  type    = number
  default = 2
}

variable "web_max_tasks" {
  type    = number
  default = 8
}

variable "database_pool_max" {
  description = "Connections per API task; max_tasks x this must stay under the database's limit"
  type        = number
  default     = 10
}

variable "waf_auth_limit_per_5_min" {
  description = "Requests to /auth and /tenants per address per 5 minutes before the WAF blocks"
  type        = number
  default     = 300
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "replicate_images_to" {
  description = "Region to copy container images to (the DR region), or null"
  type        = string
  default     = null
}
