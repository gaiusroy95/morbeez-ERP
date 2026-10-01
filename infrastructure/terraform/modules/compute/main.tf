# The running system: container images, the ECS Fargate cluster (CLOUD.2),
# the public load balancer behind the WAF — the only public entry point
# (CLOUD.3) — and three task definitions from two images:
#
#   api     — NestJS, api.<domain>; also what the driver app calls
#   web     — the owner app (Next.js), app.<domain>; reaches the API privately
#             through ECS Service Connect, never out and back through the ALB
#             (that would make every owner a single NAT address to the
#             per-IP sign-in limits — Security Audit SA-02)
#   migrate — one-off; the pipeline runs it before each rollout (Constitution VII.3)
#
# Rollouts are ECS rolling deployments: new tasks start beside the old, take
# traffic once healthy, and the deployment rolls back by itself if tasks fail
# to start (circuit breaker) or the error or latency alarms below fire while it
# runs (Constitution VII.4).

terraform {
  required_providers {
    aws    = { source = "hashicorp/aws" }
    random = { source = "hashicorp/random" }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  api_host = "api.${var.domain_name}"
  web_host = "app.${var.domain_name}"
  repos    = ["api", "web", "migrate"]
}

# ---- Container registry ----

resource "aws_ecr_repository" "this" {
  for_each             = toset(local.repos)
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE" # a tag is a commit; it never moves
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 100 images (rollback targets)"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 100 }
      action       = { type = "expire" }
    }]
  })
}

# Images are copied to the DR region as they're pushed, so a regional
# recovery doesn't depend on the lost region's registry.
resource "aws_ecr_replication_configuration" "dr" {
  count = var.replicate_images_to != null ? 1 : 0
  replication_configuration {
    rule {
      destination {
        region      = var.replicate_images_to
        registry_id = data.aws_caller_identity.current.account_id
      }
    }
  }
}

# ---- Application secrets (Constitution V.3) ----
# FIELD_ENCRYPTION_KEY encrypts farmers' bank details: it must never change
# without re-encrypting them first (see runbooks/secret-rotation.md).

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "field_key" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.name}/app/jwt-secret"
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
  # Rotated by hand (runbooks/secret-rotation.md); Terraform only creates it.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "field_key" {
  name                    = "${var.name}/app/field-encryption-key"
  recovery_window_in_days = 30
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_secretsmanager_secret_version" "field_key" {
  secret_id     = aws_secretsmanager_secret.field_key.id
  secret_string = random_password.field_key.result
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---- Security groups ----

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public HTTPS"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "Redirected to HTTPS"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_vpc" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 3000
  to_port           = 3001
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "ECS tasks - from the load balancer and each other"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-tasks" }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3001
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_tasks" {
  security_group_id            = aws_security_group.tasks.id
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  description                  = "Owner app to API through Service Connect"
}

resource "aws_vpc_security_group_egress_rule" "tasks_out" {
  security_group_id = aws_security_group.tasks.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Database, Redis, AWS endpoints, and the internet through NAT"
}

# ---- Certificate and DNS ----

resource "aws_acm_certificate" "this" {
  domain_name               = local.web_host
  subject_alternative_names = [local.api_host]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o
  }
  zone_id         = var.hosted_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_route53_record" "host" {
  for_each = toset([local.web_host, local.api_host])
  zone_id  = var.hosted_zone_id
  name     = each.key
  type     = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

# ---- Load balancer ----

resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  subnets                    = var.public_subnet_ids
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  idle_timeout               = 60
  enable_deletion_protection = var.deletion_protection
  access_logs {
    bucket  = var.logs_bucket
    prefix  = "alb"
    enabled = true
  }
}

resource "aws_lb_target_group" "api" {
  name                 = "${var.name}-api"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  health_check {
    path                = "/health/ready" # database and Redis reachable
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_target_group" "web" {
  name                 = "${var.name}-web"
  port                 = 3001
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  health_check {
    path                = "/login"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this.certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  condition {
    host_header {
      values = [local.api_host]
    }
  }
}

resource "aws_lb_listener_rule" "web" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
  condition {
    host_header {
      values = [local.web_host]
    }
  }
}

# ---- WAF in front of the load balancer (CLOUD.3) ----

resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = "REGIONAL"
  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Photo uploads are multipart bodies of up to 10 MB; the 8 KB body
        # limit in this set would refuse every one of them.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  # Counts only at first: every query is parameterised, and the SQL rule set
  # can mistake free-text notes for injection. Switch to blocking once a
  # fortnight of traffic shows no false positives.
  rule {
    name     = "aws-sqli"
    priority = 40
    override_action {
      count {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-sqli"
      sampled_requests_enabled   = true
    }
  }

  # A coarse outer limit on sign-in and signup per address; the API's own,
  # finer limits sit behind it (Security Audit SA-02).
  rule {
    name     = "auth-rate"
    priority = 50
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_auth_limit_per_5_min
        aggregate_key_type = "IP"
        scope_down_statement {
          or_statement {
            statement {
              byte_match_statement {
                search_string         = "/auth/"
                positional_constraint = "STARTS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
            statement {
              byte_match_statement {
                search_string         = "/tenants"
                positional_constraint = "STARTS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "auth-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.name}" # the prefix WAF logging requires
  retention_in_days = 90
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }
  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
}

# ---- ECS ----

resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_service_discovery_http_namespace" "this" {
  name        = "${var.name}.internal"
  description = "Service Connect: the owner app reaches the API here"
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(local.repos)
  name              = "/${var.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

# Pull images, write logs, read exactly these secrets.
resource "aws_iam_role" "execution" {
  name = "${var.name}-ecs-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          var.database_app_url_secret_arn,
          var.database_owner_url_secret_arn,
          var.database_app_password_secret_arn,
          var.redis_url_secret_arn,
          aws_secretsmanager_secret.jwt.arn,
          aws_secretsmanager_secret.field_key.arn,
        ]
      },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [var.database_kms_key_arn] },
    ]
  })
}

# What the API itself may do in AWS: store uploads, nothing else.
resource "aws_iam_role" "api_task" {
  name = "${var.name}-api-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "api_task" {
  name = "uploads"
  role = aws_iam_role.api_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${var.uploads_bucket_arn}/*" },
      { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt"], Resource = var.uploads_kms_key_arn },
    ]
  })
}

resource "aws_iam_role" "plain_task" {
  name = "${var.name}-plain-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

locals {
  image = { for k in local.repos : k => "${aws_ecr_repository.this[k].repository_url}:${var.image_tag}" }
  logs = {
    for k in local.repos : k => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app[k].name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = k
      }
    }
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "api"
    image        = local.image["api"]
    essential    = true
    portMappings = [{ name = "http", containerPort = 3000, protocol = "tcp", appProtocol = "http" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
      { name = "LOG_LEVEL", value = "info" },
      { name = "CORS_ORIGIN", value = "https://${local.web_host}" },
      # The ALB and the owner app's tasks report the client address; nothing else in the VPC can reach the API.
      { name = "TRUST_PROXY", value = "loopback, ${var.vpc_cidr}" },
      { name = "UPLOADS_BUCKET", value = var.uploads_bucket },
      { name = "AWS_REGION", value = data.aws_region.current.name },
      { name = "DATABASE_POOL_MAX", value = tostring(var.database_pool_max) },
      { name = "LOGIN_ATTEMPTS_PER_IP_PER_MINUTE", value = "60" },
      { name = "TENANT_RATE_LIMIT_PER_MINUTE", value = "1200" },
      # Open signup: anyone can create a business, which starts on a 30-day free trial.
      # "false" makes it invite-only again (provision-tenant, runbooks/first-deploy.md).
      { name = "SIGNUP_ENABLED", value = "true" },
    ]
    secrets = [
      { name = "APP_DATABASE_URL", valueFrom = var.database_app_url_secret_arn },
      { name = "REDIS_URL", valueFrom = var.redis_url_secret_arn },
      { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt.arn },
      { name = "FIELD_ENCRYPTION_KEY", valueFrom = aws_secretsmanager_secret.field_key.arn },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = local.logs["api"]
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.plain_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "web"
    image        = local.image["web"]
    essential    = true
    portMappings = [{ name = "http", containerPort = 3001, protocol = "tcp", appProtocol = "http" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "API_BASE_URL", value = "http://api.internal:3000" },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/login > /dev/null || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = local.logs["web"]
  }])
}

# The pipeline runs this with `aws ecs run-task` and waits for exit code 0
# before any new code rolls out.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.plain_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name      = "migrate"
    image     = local.image["migrate"]
    essential = true
    environment = [
      { name = "NODE_ENV", value = "production" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = var.database_owner_url_secret_arn },
      { name = "APP_DB_PASSWORD", valueFrom = var.database_app_password_secret_arn },
    ]
    logConfiguration = local.logs["migrate"]
  }])
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api_min_tasks
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  enable_execute_command            = false
  propagate_tags                    = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
    service {
      port_name      = "http"
      discovery_name = "api"
      client_alias {
        port     = 3000
        dns_name = "api.internal"
      }
    }
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  alarms {
    enable      = true
    rollback    = true
    alarm_names = [aws_cloudwatch_metric_alarm.deploy_api_5xx.alarm_name, aws_cloudwatch_metric_alarm.deploy_api_latency.alarm_name]
  }

  # The pipeline owns which image runs and autoscaling owns how many.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

resource "aws_ecs_service" "web" {
  name                              = "web"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.web.arn
  desired_count                     = var.web_min_tasks
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  propagate_tags                    = "SERVICE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3001
  }

  # A client only: it resolves api.internal, publishes nothing.
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.this.arn
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  alarms {
    enable      = true
    rollback    = true
    alarm_names = [aws_cloudwatch_metric_alarm.deploy_web_5xx.alarm_name]
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# ---- Alarms a rollout watches (and rolls back on) ----

resource "aws_cloudwatch_metric_alarm" "deploy_api_5xx" {
  alarm_name          = "${var.name}-deploy-api-5xx"
  alarm_description   = "API server errors above 2% of requests - rolls a deployment back"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 2
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  metric_query {
    id          = "rate"
    expression  = "IF(requests > 20, 100 * errors / requests, 0)"
    label       = "5xx %"
    return_data = true
  }
  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      period      = 60
      stat        = "Sum"
      dimensions  = { LoadBalancer = aws_lb.this.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
    }
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      period      = 60
      stat        = "Sum"
      dimensions  = { LoadBalancer = aws_lb.this.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "deploy_api_latency" {
  alarm_name          = "${var.name}-deploy-api-latency"
  alarm_description   = "API p95 over 1.5 s - rolls a deployment back"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  dimensions          = { LoadBalancer = aws_lb.this.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 1.5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "deploy_web_5xx" {
  alarm_name          = "${var.name}-deploy-web-5xx"
  alarm_description   = "Owner app server errors above 2% of requests - rolls a deployment back"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 2
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"
  metric_query {
    id          = "rate"
    expression  = "IF(requests > 20, 100 * errors / requests, 0)"
    label       = "5xx %"
    return_data = true
  }
  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      period      = 60
      stat        = "Sum"
      dimensions  = { LoadBalancer = aws_lb.this.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }
    }
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      period      = 60
      stat        = "Sum"
      dimensions  = { LoadBalancer = aws_lb.this.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }
    }
  }
}

# ---- Autoscaling ----

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.api_min_tasks
  max_capacity       = var.api_max_tasks
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "${var.name}-api-cpu"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value       = 55
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "api_requests" {
  name               = "${var.name}-api-requests"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value       = var.api_requests_per_task_per_minute
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.this.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
  }
}

# The morning rush (order booking and dispatch, 04:00-08:00 IST) is known in
# advance, so capacity is raised before it starts rather than chasing it.
resource "aws_appautoscaling_scheduled_action" "api_rush_start" {
  name               = "${var.name}-api-rush-start"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(30 3 * * ? *)"
  timezone           = "Asia/Kolkata"
  scalable_target_action {
    min_capacity = var.api_rush_min_tasks
    max_capacity = var.api_max_tasks
  }
}

resource "aws_appautoscaling_scheduled_action" "api_rush_end" {
  name               = "${var.name}-api-rush-end"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  schedule           = "cron(30 8 * * ? *)"
  timezone           = "Asia/Kolkata"
  scalable_target_action {
    min_capacity = var.api_min_tasks
    max_capacity = var.api_max_tasks
  }
}

resource "aws_appautoscaling_target" "web" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.web_min_tasks
  max_capacity       = var.web_max_tasks
}

resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${var.name}-web-cpu"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
