# S3 (Technology Stack §05):
#   uploads — stop photos and proof of delivery. Private, KMS-encrypted,
#             versioned (an overwrite or delete is recoverable), TLS-only,
#             replicated to the DR region.
#   logs    — load balancer access logs, 90 days.

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.dr]
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "uploads" {
  description             = "${var.name} uploads bucket"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  multi_region            = true
}

resource "aws_kms_alias" "uploads" {
  name          = "alias/${var.name}-uploads"
  target_key_id = aws_kms_key.uploads.key_id
}

resource "aws_s3_bucket" "uploads" {
  bucket = "${var.name}-uploads-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.uploads.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "age-out"
    status = "Enabled"
    filter {}
    # Photos are looked at in the first weeks (disputes); after that they are evidence.
    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TlsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# ---- Replication to the DR region ----

resource "aws_kms_replica_key" "uploads_dr" {
  count                   = var.replicate_to_dr ? 1 : 0
  provider                = aws.dr
  primary_key_arn         = aws_kms_key.uploads.arn
  description             = "${var.name} uploads replica"
  deletion_window_in_days = 30
}

resource "aws_s3_bucket" "uploads_dr" {
  count    = var.replicate_to_dr ? 1 : 0
  provider = aws.dr
  bucket   = "${var.name}-uploads-dr-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "uploads_dr" {
  count                   = var.replicate_to_dr ? 1 : 0
  provider                = aws.dr
  bucket                  = aws_s3_bucket.uploads_dr[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "uploads_dr" {
  count    = var.replicate_to_dr ? 1 : 0
  provider = aws.dr
  bucket   = aws_s3_bucket.uploads_dr[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads_dr" {
  count    = var.replicate_to_dr ? 1 : 0
  provider = aws.dr
  bucket   = aws_s3_bucket.uploads_dr[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_replica_key.uploads_dr[0].arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_iam_role" "replication" {
  count = var.replicate_to_dr ? 1 : 0
  name  = "${var.name}-uploads-replication"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "s3.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "replication" {
  count = var.replicate_to_dr ? 1 : 0
  name  = "replicate-uploads"
  role  = aws_iam_role.replication[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetReplicationConfiguration", "s3:ListBucket"], Resource = aws_s3_bucket.uploads.arn },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging"]
        Resource = "${aws_s3_bucket.uploads.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"]
        Resource = "${aws_s3_bucket.uploads_dr[0].arn}/*"
      },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.uploads.arn },
      { Effect = "Allow", Action = ["kms:Encrypt"], Resource = aws_kms_replica_key.uploads_dr[0].arn },
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "uploads" {
  count      = var.replicate_to_dr ? 1 : 0
  bucket     = aws_s3_bucket.uploads.id
  role       = aws_iam_role.replication[0].arn
  depends_on = [aws_s3_bucket_versioning.uploads, aws_s3_bucket_versioning.uploads_dr]

  rule {
    id     = "to-dr-region"
    status = "Enabled"
    filter {}
    delete_marker_replication {
      status = "Enabled"
    }
    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
    destination {
      bucket        = aws_s3_bucket.uploads_dr[0].arn
      storage_class = "STANDARD_IA"
      encryption_configuration {
        replica_kms_key_id = aws_kms_replica_key.uploads_dr[0].arn
      }
    }
  }
}

# ---- Load balancer access logs ----

data "aws_elb_service_account" "this" {}

resource "aws_s3_bucket" "logs" {
  bucket = "${var.name}-logs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ALB log delivery supports only S3-managed keys.
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = var.log_retention_days
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AlbAccessLogs"
      Effect    = "Allow"
      Principal = { AWS = data.aws_elb_service_account.this.arn }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.logs.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"
    }]
  })
}
