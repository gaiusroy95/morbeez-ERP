variable "domain_name" {
  description = "Staging's own domain, e.g. dev.morbeez.in"
  type        = string
}

variable "hosted_zone_id" {
  type = string
}

variable "image_tag" {
  type = string
}

variable "github_repository" {
  type = string
}

variable "alert_emails" {
  type = list(string)
}
