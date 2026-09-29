# Dev — its own AWS account (CLOUD.4) for trying infrastructure changes and
# shared integration testing; day-to-day development runs locally on
# docker-compose. Same modules as staging, same small sizes.

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

locals {
  name   = "morbeez-dev"
  region = "ap-south-1"
  tags = {
    Project     = "morbeez"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

provider "aws" {
  region = local.region
  default_tags {
    tags = local.tags
  }
}

# Modules that can copy to a DR region take this provider; staging turns the copies off.
provider "aws" {
  alias  = "dr"
  region = "ap-south-2"
  default_tags {
    tags = local.tags
  }
}

module "network" {
  source             = "../../modules/network"
  name               = local.name
  region             = local.region
  cidr               = "10.40.0.0/16"
  single_nat_gateway = true
}

module "storage" {
  source             = "../../modules/storage"
  name               = local.name
  replicate_to_dr    = false
  log_retention_days = 30
  providers          = { aws = aws, aws.dr = aws.dr }
}

module "database" {
  source                    = "../../modules/database"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.data_subnet_ids
  client_security_group_ids = [module.compute.task_security_group_id]
  instance_class            = "db.t4g.medium"
  allocated_storage_gb      = 20
  max_allocated_storage_gb  = 100
  multi_az                  = false
  backup_retention_days     = 7
  deletion_protection       = false
  replicate_backups_to_dr   = false
  providers                 = { aws = aws, aws.dr = aws.dr }
}

module "cache" {
  source                    = "../../modules/cache"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.data_subnet_ids
  client_security_group_ids = [module.compute.task_security_group_id]
  node_type                 = "cache.t4g.micro"
  replicas                  = 0
}

module "compute" {
  source                           = "../../modules/compute"
  name                             = local.name
  domain_name                      = var.domain_name
  hosted_zone_id                   = var.hosted_zone_id
  image_tag                        = var.image_tag
  vpc_id                           = module.network.vpc_id
  vpc_cidr                         = module.network.vpc_cidr
  public_subnet_ids                = module.network.public_subnet_ids
  private_subnet_ids               = module.network.private_subnet_ids
  logs_bucket                      = module.storage.logs_bucket
  uploads_bucket                   = module.storage.uploads_bucket
  uploads_bucket_arn               = module.storage.uploads_bucket_arn
  uploads_kms_key_arn              = module.storage.uploads_kms_key_arn
  database_app_url_secret_arn      = module.database.app_url_secret_arn
  database_owner_url_secret_arn    = module.database.owner_url_secret_arn
  database_app_password_secret_arn = module.database.app_password_secret_arn
  database_kms_key_arn             = module.database.kms_key_arn
  redis_url_secret_arn             = module.cache.url_secret_arn
  api_cpu                          = 512
  api_memory                       = 1024
  api_min_tasks                    = 1
  api_rush_min_tasks               = 1
  api_max_tasks                    = 3
  web_min_tasks                    = 1
  web_max_tasks                    = 2
  log_retention_days               = 14
  deletion_protection              = false
}

module "observability" {
  source                       = "../../modules/observability"
  name                         = local.name
  region                       = local.region
  alert_emails                 = var.alert_emails
  cluster_name                 = module.compute.cluster_name
  alb_arn_suffix               = module.compute.alb_arn_suffix
  api_target_group_arn_suffix  = module.compute.api_target_group_arn_suffix
  web_target_group_arn_suffix  = module.compute.web_target_group_arn_suffix
  api_log_group                = module.compute.log_group_names["api"]
  waf_name                     = module.compute.waf_name
  db_instance_id               = module.database.instance_id
  redis_replication_group_id   = module.cache.replication_group_id
  db_min_freeable_memory_bytes = 268435456
  db_min_free_storage_bytes    = 5368709120
  db_max_connections_alarm     = 300
  monthly_budget_usd           = 300
}

module "cicd" {
  source                        = "../../modules/cicd"
  name                          = local.name
  github_repository             = var.github_repository
  github_environment            = "dev"
  cluster_name                  = module.compute.cluster_name
  ecr_repository_arns           = module.compute.ecr_repository_arns
  task_role_arns                = module.compute.task_role_arns
  database_instance_id          = module.database.instance_id
  database_kms_key_arn          = module.database.kms_key_arn
  database_owner_url_secret_arn = module.database.owner_url_secret_arn
}
