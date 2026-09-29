variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "alert_emails" {
  description = "Who gets paged. Add a PagerDuty/Opsgenie endpoint to the SNS topic for on-call."
  type        = list(string)
}

variable "cluster_name" {
  type = string
}

variable "alb_arn_suffix" {
  type = string
}

variable "api_target_group_arn_suffix" {
  type = string
}

variable "web_target_group_arn_suffix" {
  type = string
}

variable "api_log_group" {
  type = string
}

variable "waf_name" {
  type = string
}

variable "db_instance_id" {
  type = string
}

variable "redis_replication_group_id" {
  type = string
}

variable "db_min_freeable_memory_bytes" {
  type    = number
  default = 1073741824 # 1 GiB
}

variable "db_min_free_storage_bytes" {
  type    = number
  default = 21474836480 # 20 GiB
}

variable "db_max_connections_alarm" {
  description = "About 80% of the instance's max_connections"
  type        = number
  default     = 600
}

variable "monthly_budget_usd" {
  type    = number
  default = 1500
}
