# Backups beyond RDS's own 35-day point-in-time window (Constitution VII.7):
#
#   daily   kept 35 days     — the recent past, at any day
#   monthly kept 13 months   — month-end books, a year back
#   yearly  kept 8 years     — books of account must be kept eight years
#                               (Companies Act 2013, s.128)
#
# Every copy is also written to a vault in the DR region, and both vaults
# are locked: a backup can't be deleted before its retention ends, even by an
# administrator — the defence against ransomware or a compromised account.
# Resources are chosen by tag (Backup = <backup_tag>).

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.dr]
    }
  }
}

resource "aws_kms_key" "vault" {
  description             = "${var.name} backup vault"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_backup_vault" "primary" {
  name        = var.name
  kms_key_arn = aws_kms_key.vault.arn
}

resource "aws_backup_vault_lock_configuration" "primary" {
  backup_vault_name  = aws_backup_vault.primary.name
  min_retention_days = 7
  max_retention_days = 3000
}

resource "aws_kms_key" "vault_dr" {
  provider                = aws.dr
  description             = "${var.name} backup vault (DR region)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_backup_vault" "dr" {
  provider    = aws.dr
  name        = "${var.name}-dr"
  kms_key_arn = aws_kms_key.vault_dr.arn
}

resource "aws_backup_vault_lock_configuration" "dr" {
  provider           = aws.dr
  backup_vault_name  = aws_backup_vault.dr.name
  min_retention_days = 7
  max_retention_days = 3000
}

resource "aws_backup_plan" "this" {
  name = var.name

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(30 21 * * ? *)" # 03:00 IST
    start_window      = 60
    completion_window = 360
    lifecycle {
      delete_after = 35
    }
    copy_action {
      destination_vault_arn = aws_backup_vault.dr.arn
      lifecycle {
        delete_after = 35
      }
    }
  }

  rule {
    rule_name         = "monthly"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(30 21 1 * ? *)"
    start_window      = 60
    completion_window = 720
    lifecycle {
      delete_after = 400
    }
    copy_action {
      destination_vault_arn = aws_backup_vault.dr.arn
      lifecycle {
        delete_after = 400
      }
    }
  }

  rule {
    rule_name         = "yearly"
    target_vault_name = aws_backup_vault.primary.name
    schedule          = "cron(30 21 1 4 ? *)" # 1 April, the start of India's financial year
    start_window      = 60
    completion_window = 1440
    lifecycle {
      delete_after = 2922
    }
    copy_action {
      destination_vault_arn = aws_backup_vault.dr.arn
      lifecycle {
        delete_after = 2922
      }
    }
  }
}

resource "aws_iam_role" "backup" {
  name = "${var.name}-backup"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "backup.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_selection" "tagged" {
  name         = "${var.name}-tagged"
  plan_id      = aws_backup_plan.this.id
  iam_role_arn = aws_iam_role.backup.arn
  selection_tag {
    type  = "STRINGEQUALS"
    key   = "Backup"
    value = var.backup_tag
  }
}

# A failed or expired backup job is an incident, not a log line.
resource "aws_backup_vault_notifications" "primary" {
  backup_vault_name   = aws_backup_vault.primary.name
  sns_topic_arn       = var.alerts_topic_arn
  backup_vault_events = ["BACKUP_JOB_FAILED", "BACKUP_JOB_EXPIRED", "COPY_JOB_FAILED", "RESTORE_JOB_COMPLETED"]
}
