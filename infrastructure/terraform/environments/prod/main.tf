# Production — its own AWS account (CLOUD.4), ap-south-1 (Mumbai) across
# three AZs (CLOUD.1), with backups, images, uploads and secrets copied to
# ap-south-2 (Hyderabad) for disaster recovery. Both regions are in India,
# so tenant data never leaves the country (Technology Stack §05's data
# residency condition).

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
  name   = "morbeez-prod"
  region = "ap-south-1"
  tags = {
    Project     = "morbeez"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

provider "aws" {
  region = local.region
  default_tags {
    tags = local.tags
  }
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags {
    tags = local.tags
  }
}

module "network" {
  source = "../../modules/network"
  name   = local.name
  region = local.region
  cidr   = "10.20.0.0/16"
}

module "storage" {
  source    = "../../modules/storage"
  name      = local.name
  providers = { aws = aws, aws.dr = aws.dr }
}

module "database" {
  source                    = "../../modules/database"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.data_subnet_ids
  client_security_group_ids = [module.compute.task_security_group_id]
  instance_class            = var.db_instance_class
  dr_region                 = var.dr_region
  providers                 = { aws = aws, aws.dr = aws.dr }
}

module "cache" {
  source                    = "../../modules/cache"
  name                      = local.name
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.data_subnet_ids
  client_security_group_ids = [module.compute.task_security_group_id]
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
  replicate_images_to              = var.dr_region
}

module "observability" {
  source                      = "../../modules/observability"
  name                        = local.name
  region                      = local.region
  alert_emails                = var.alert_emails
  cluster_name                = module.compute.cluster_name
  alb_arn_suffix              = module.compute.alb_arn_suffix
  api_target_group_arn_suffix = module.compute.api_target_group_arn_suffix
  web_target_group_arn_suffix = module.compute.web_target_group_arn_suffix
  api_log_group               = module.compute.log_group_names["api"]
  waf_name                    = module.compute.waf_name
  db_instance_id              = module.database.instance_id
  redis_replication_group_id  = module.cache.replication_group_id
  monthly_budget_usd          = var.monthly_budget_usd
}

module "backup" {
  source           = "../../modules/backup"
  name             = local.name
  alerts_topic_arn = module.observability.alerts_topic_arn
  providers        = { aws = aws, aws.dr = aws.dr }
}

module "cicd" {
  source                        = "../../modules/cicd"
  name                          = local.name
  github_repository             = var.github_repository
  github_environment            = "production"
  cluster_name                  = module.compute.cluster_name
  ecr_repository_arns           = module.compute.ecr_repository_arns
  task_role_arns                = module.compute.task_role_arns
  database_instance_id          = module.database.instance_id
  database_kms_key_arn          = module.database.kms_key_arn
  database_owner_url_secret_arn = module.database.owner_url_secret_arn
}
