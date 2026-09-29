variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Data-tier subnets (no internet route)"
  type        = list(string)
}

variable "client_security_group_ids" {
  description = "Security groups allowed to connect on 5432 (the ECS tasks)"
  type        = list(string)
}

variable "engine_version" {
  type    = string
  default = "16.4"
}

variable "instance_class" {
  type    = string
  default = "db.m7g.large"
}

variable "allocated_storage_gb" {
  type    = number
  default = 100
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling"
  type        = number
  default     = 1000
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  description = "Point-in-time recovery window (RDS maximum is 35)"
  type        = number
  default     = 35
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "read_replica_count" {
  type    = number
  default = 0
}

variable "replicate_backups_to_dr" {
  description = "Replicate automated backups (and secrets) to the DR region"
  type        = bool
  default     = true
}

variable "dr_region" {
  type    = string
  default = "ap-south-2"
}

variable "backup_tag" {
  description = "Value of the Backup tag AWS Backup selects on"
  type        = string
  default     = "daily-monthly-yearly"
}
