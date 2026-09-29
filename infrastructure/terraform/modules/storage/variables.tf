variable "name" {
  type = string
}

variable "replicate_to_dr" {
  type    = bool
  default = true
}

variable "log_retention_days" {
  type    = number
  default = 90
}
