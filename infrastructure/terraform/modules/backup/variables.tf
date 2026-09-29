variable "name" {
  type = string
}

variable "backup_tag" {
  description = "Resources tagged Backup = this value are backed up"
  type        = string
  default     = "daily-monthly-yearly"
}

variable "alerts_topic_arn" {
  type = string
}
