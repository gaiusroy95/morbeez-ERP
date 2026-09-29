variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "client_security_group_ids" {
  type = list(string)
}

variable "node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "replicas" {
  description = "Read replicas beside the primary; 1+ gives automatic failover across AZs"
  type        = number
  default     = 1
}
