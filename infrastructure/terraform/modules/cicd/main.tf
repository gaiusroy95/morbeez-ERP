# GitHub Actions reaches AWS through OIDC: short-lived credentials per run,
# no long-lived keys anywhere (Constitution V.3). Each role trusts only this
# repository's matching GitHub environment, so a workflow on a branch or a
# fork can't assume it; the production environment also needs a reviewer's
# approval in GitHub before its jobs start.

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  oidc_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
  trust = {
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.github_environment}"
        }
      }
    }]
  }
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.name
}

# ---- Deploy: push images, migrate, roll out ----

resource "aws_iam_role" "deploy" {
  name               = "${var.name}-github-deploy"
  assume_role_policy = jsonencode(local.trust)
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DescribeImages",
          "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart", "ecr:DescribeImageScanFindings",
        ]
        Resource = var.ecr_repository_arns
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
        Resource = "*" # task-definition actions don't support resource scoping
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = "arn:aws:ecs:${local.region}:${local.account}:service/${var.cluster_name}/*"
      },
      {
        Effect    = "Allow"
        Action    = ["ecs:RunTask"]
        Resource  = "arn:aws:ecs:${local.region}:${local.account}:task-definition/${var.name}-migrate:*"
        Condition = { ArnEquals = { "ecs:cluster" = "arn:aws:ecs:${local.region}:${local.account}:cluster/${var.cluster_name}" } }
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks"]
        Resource = "arn:aws:ecs:${local.region}:${local.account}:task/${var.cluster_name}/*"
      },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = var.task_role_arns },
      {
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account}:log-group:/${var.name}/*"
      },
      { Effect = "Allow", Action = ["cloudwatch:DescribeAlarms"], Resource = "*" },
    ]
  })
}

# ---- Restore drill: restore the latest backup, verify, delete (Constitution VII.7) ----

resource "aws_iam_role" "drill" {
  name = "${var.name}-github-restore-drill"
  assume_role_policy = jsonencode(merge(local.trust, {
    Statement = [merge(local.trust.Statement[0], {
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.github_environment}-drill"
        }
      }
    })]
  }))
}

resource "aws_iam_role_policy" "drill" {
  name = "restore-drill"
  role = aws_iam_role.drill.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["rds:RestoreDBInstanceToPointInTime", "rds:AddTagsToResource"]
        Resource = [
          "arn:aws:rds:${local.region}:${local.account}:db:${var.database_instance_id}",
          "arn:aws:rds:${local.region}:${local.account}:db:${var.name}-drill-*",
          "arn:aws:rds:${local.region}:${local.account}:subgrp:*",
          "arn:aws:rds:${local.region}:${local.account}:pg:*",
          "arn:aws:rds:${local.region}:${local.account}:og:*",
        ]
      },
      { Effect = "Allow", Action = ["rds:DescribeDBInstances"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["rds:DeleteDBInstance"]
        Resource = "arn:aws:rds:${local.region}:${local.account}:db:${var.name}-drill-*"
      },
      { Effect = "Allow", Action = ["kms:CreateGrant", "kms:DescribeKey"], Resource = var.database_kms_key_arn },
      {
        Effect    = "Allow"
        Action    = ["ecs:RunTask"]
        Resource  = "arn:aws:ecs:${local.region}:${local.account}:task-definition/${var.name}-migrate:*"
        Condition = { ArnEquals = { "ecs:cluster" = "arn:aws:ecs:${local.region}:${local.account}:cluster/${var.cluster_name}" } }
      },
      { Effect = "Allow", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:${local.region}:${local.account}:task/${var.cluster_name}/*" },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = var.task_role_arns },
      {
        Effect   = "Allow"
        Action   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account}:log-group:/${var.name}/*"
      },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.database_owner_url_secret_arn },
    ]
  })
}
