variable "name" {
  description = "Prefix for every resource, e.g. morbeez-prod"
  type        = string
}

variable "region" {
  description = "AWS region, for VPC endpoint service names"
  type        = string
}

variable "cidr" {
  description = "VPC address range"
  type        = string
  default     = "10.20.0.0/16"
}

variable "az_count" {
  description = "Availability zones to spread across (CLOUD.1 multi-AZ)"
  type        = number
  default     = 3
}

variable "single_nat_gateway" {
  description = "One NAT gateway for all AZs (cheaper, not AZ-resilient) — non-production only"
  type        = bool
  default     = false
}

variable "flow_log_retention_days" {
  type    = number
  default = 90
}
