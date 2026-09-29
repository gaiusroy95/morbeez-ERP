# PostgreSQL 16 on RDS (Technology Stack §05 — standard Postgres, not
# Aurora, for full extension compatibility). Multi-AZ with a synchronous
# standby (CLOUD.1), in the data subnets with no public address (CLOUD.3),
# encrypted with its own key (Constitution V.4), 35 days of point-in-time
# recovery, and its automated backups replicated to the DR region.
#
# Two sets of credentials, two secrets (Constitution V.3, least privilege):
#   owner — the master user; runs migrations only (the migration task).
#   app   — morbeez_app, DML-only and RLS-bound; what the API uses. The
#           role itself is created by the migrations, with this password.

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.dr]
    }
    random = { source = "hashicorp/random" }
  }
}

resource "aws_kms_key" "db" {
  description             = "${var.name} database storage, snapshots and secrets"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  multi_region            = true
}

resource "aws_kms_alias" "db" {
  name          = "alias/${var.name}-db"
  target_key_id = aws_kms_key.db.key_id
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "PostgreSQL - from the application tasks only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  for_each                     = toset(var.client_security_group_ids)
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from application tasks"
}

resource "aws_db_parameter_group" "this" {
  name   = "${var.name}-pg16"
  family = "postgres16"

  # TLS only (Constitution V.4); the images trust the RDS CA and verify it.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # pg_stat_statements — the per-query cost view the migrations enable.
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }
  # Anything slower than half a second is logged (Performance Audit follow-up).
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
  # A transaction left open by a crashed request must not hold locks for long.
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }
  parameter {
    name  = "log_lock_waits"
    value = "1"
  }
}

resource "random_password" "owner" {
  length  = 40
  special = false
}

resource "random_password" "app" {
  length  = 40
  special = false
}

resource "aws_db_instance" "this" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = "morbeez"
  username = "morbeez_owner"
  password = random_password.owner.result
  port     = 5432

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.db.arn

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.this.name

  backup_retention_period   = var.backup_retention_days
  backup_window             = "20:30-21:30" # 02:00-03:00 IST, the quietest hour
  maintenance_window        = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.db.arn
  performance_insights_retention_period = 7
  monitoring_interval                   = 30
  monitoring_role_arn                   = aws_iam_role.monitoring.arn
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  auto_minor_version_upgrade = true
  apply_immediately          = false

  tags = { Backup = var.backup_tag }
}

# Continuous replication of automated backups to the DR region: point-in-time
# restore there, minutes behind, if the primary region is lost.
resource "aws_db_instance_automated_backups_replication" "dr" {
  count                  = var.replicate_backups_to_dr ? 1 : 0
  provider               = aws.dr
  source_db_instance_arn = aws_db_instance.this.arn
  kms_key_id             = aws_kms_replica_key.db_dr[0].arn
  retention_period       = var.backup_retention_days
}

resource "aws_kms_replica_key" "db_dr" {
  count                   = var.replicate_backups_to_dr ? 1 : 0
  provider                = aws.dr
  description             = "${var.name} database backups in the DR region"
  primary_key_arn         = aws_kms_key.db.arn
  deletion_window_in_days = 30
}

# Reports and AI read from here once they outgrow the primary (Scaling plan, step 3).
resource "aws_db_instance" "replica" {
  count                           = var.read_replica_count
  identifier                      = "${var.name}-replica-${count.index}"
  replicate_source_db             = aws_db_instance.this.identifier
  instance_class                  = var.instance_class
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.db.arn
  vpc_security_group_ids          = [aws_security_group.db.id]
  parameter_group_name            = aws_db_parameter_group.this.name
  publicly_accessible             = false
  skip_final_snapshot             = true
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.db.arn
  auto_minor_version_upgrade      = true
}

resource "aws_iam_role" "monitoring" {
  name = "${var.name}-rds-monitoring"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "monitoring.rds.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  role       = aws_iam_role.monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ---- Secrets: whole connection strings, so no container assembles one ----

locals {
  query = "sslmode=verify-full"
}

resource "aws_secretsmanager_secret" "owner_url" {
  name                    = "${var.name}/database/owner-url"
  description             = "Migration owner connection string - the migration task only"
  kms_key_id              = aws_kms_key.db.arn
  recovery_window_in_days = 30
  dynamic "replica" {
    for_each = var.replicate_backups_to_dr ? [1] : []
    content {
      region     = var.dr_region
      kms_key_id = aws_kms_replica_key.db_dr[0].arn
    }
  }
}

resource "aws_secretsmanager_secret_version" "owner_url" {
  secret_id     = aws_secretsmanager_secret.owner_url.id
  secret_string = "postgres://morbeez_owner:${random_password.owner.result}@${aws_db_instance.this.address}:5432/morbeez?${local.query}"
  # Rotated by hand (runbooks/secret-rotation.md); Terraform only creates it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "app_password" {
  name                    = "${var.name}/database/app-password"
  description             = "morbeez_app password - read by the migration that creates the role"
  kms_key_id              = aws_kms_key.db.arn
  recovery_window_in_days = 30
  dynamic "replica" {
    for_each = var.replicate_backups_to_dr ? [1] : []
    content {
      region     = var.dr_region
      kms_key_id = aws_kms_replica_key.db_dr[0].arn
    }
  }
}

resource "aws_secretsmanager_secret_version" "app_password" {
  secret_id     = aws_secretsmanager_secret.app_password.id
  secret_string = random_password.app.result
  # Rotated by hand (runbooks/secret-rotation.md); Terraform only creates it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "app_url" {
  name                    = "${var.name}/database/app-url"
  description             = "morbeez_app connection string - the API"
  kms_key_id              = aws_kms_key.db.arn
  recovery_window_in_days = 30
  dynamic "replica" {
    for_each = var.replicate_backups_to_dr ? [1] : []
    content {
      region     = var.dr_region
      kms_key_id = aws_kms_replica_key.db_dr[0].arn
    }
  }
}

resource "aws_secretsmanager_secret_version" "app_url" {
  secret_id     = aws_secretsmanager_secret.app_url.id
  secret_string = "postgres://morbeez_app:${random_password.app.result}@${aws_db_instance.this.address}:5432/morbeez?${local.query}"
  # Rotated by hand (runbooks/secret-rotation.md); Terraform only creates it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
