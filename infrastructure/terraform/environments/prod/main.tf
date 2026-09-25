# prod environment — composes the modules below.
# Cloud & Region: AWS, ap-south-1 (Technology Stack, Section 05).
# Isolated account/project per environment (Constitution VII, blast-radius
# containment) — not just a namespace.

module "network" {
  source = "../../modules/network"
}

module "database" {
  source = "../../modules/database"
}

module "cache" {
  source = "../../modules/cache"
}

module "event_bus" {
  source = "../../modules/event-bus"
}

module "compute" {
  source = "../../modules/compute"
}

module "storage" {
  source = "../../modules/storage"
}

module "observability" {
  source = "../../modules/observability"
}
