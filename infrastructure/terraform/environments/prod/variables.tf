variable "domain_name" {
  description = "Apex domain, e.g. morbeez.in — the owner app is app.<domain>, the API api.<domain>"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone for domain_name (in this account)"
  type        = string
}

variable "image_tag" {
  description = "Commit SHA of the images for the first apply; the CD pipeline owns it afterwards"
  type        = string
}

variable "github_repository" {
  description = "owner/repo that deploys here"
  type        = string
}

variable "alert_emails" {
  type = list(string)
}

variable "dr_region" {
  type    = string
  default = "ap-south-2"
}

variable "db_instance_class" {
  type    = string
  default = "db.m7g.large"
}

variable "monthly_budget_usd" {
  type    = number
  default = 1500
}
