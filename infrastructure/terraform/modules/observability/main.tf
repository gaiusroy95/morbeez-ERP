# Alarms that page, tied to the SLOs in the deployment plan (Constitution
# VII.6: observability ships with the feature), and one dashboard.
#
#   SLO 1  API availability 99.9%        — 5xx rate, unhealthy targets
#   SLO 2  API p95 under 500 ms          — latency (alarm at 1 s sustained)
#   SLO 3  no failed ledger writes       — error-level log lines
#
# The deployment-time alarms (which roll a release back) live beside the
# services in the compute module; these are the always-on ones.

resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

locals {
  actions = [aws_sns_topic.alerts.arn]
  alb     = { LoadBalancer = var.alb_arn_suffix }
  tg_api  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.api_target_group_arn_suffix }
  tg_web  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.web_target_group_arn_suffix }
}

# ---- API and owner app (SLO 1, 2) ----

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name}-api-5xx"
  alarm_description   = "API server errors above 1% of requests for 10 minutes (SLO 1)"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1
  evaluation_periods  = 10
  datapoints_to_alarm = 8
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
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
      dimensions  = local.tg_api
    }
  }
  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      period      = 60
      stat        = "Sum"
      dimensions  = local.tg_api
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${var.name}-alb-5xx"
  alarm_description   = "The load balancer itself answering 502/503/504 - no healthy target, or targets failing"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_ELB_5XX_Count"
  dimensions          = local.alb
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "${var.name}-api-p95"
  alarm_description   = "API p95 above 1 s for 10 minutes (SLO 2 is 500 ms)"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  dimensions          = local.tg_api
  period              = 60
  evaluation_periods  = 10
  datapoints_to_alarm = 8
  threshold           = 1
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  for_each            = { api = local.tg_api, web = local.tg_web }
  alarm_name          = "${var.name}-${each.key}-unhealthy"
  alarm_description   = "A ${each.key} task has failed its health check for 5 minutes"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = each.value
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

resource "aws_cloudwatch_metric_alarm" "ecs_resource" {
  for_each = {
    "api-cpu"    = { service = "api", metric = "CPUUtilization" }
    "api-memory" = { service = "api", metric = "MemoryUtilization" }
    "web-memory" = { service = "web", metric = "MemoryUtilization" }
  }
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = "${each.value.service} ${each.value.metric} above 85% for 15 minutes - autoscaling isn't keeping up"
  namespace           = "AWS/ECS"
  metric_name         = each.value.metric
  dimensions          = { ClusterName = var.cluster_name, ServiceName = each.value.service }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ---- Errors in the logs (SLO 3) ----
# pino writes numeric levels; 50 and above is error/fatal. The ledger's own
# failures (a posting refused, a period lock) surface here too.

resource "aws_cloudwatch_log_metric_filter" "api_errors" {
  name           = "${var.name}-api-errors"
  log_group_name = var.api_log_group
  pattern        = "{ $.level >= 50 }"
  metric_transformation {
    name          = "ApiErrorLogs"
    namespace     = "Morbeez/${var.name}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${var.name}-api-error-logs"
  alarm_description   = "More than 10 error-level log lines in 5 minutes - look for the request ids"
  namespace           = "Morbeez/${var.name}"
  metric_name         = "ApiErrorLogs"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
}

resource "aws_cloudwatch_log_metric_filter" "sign_in_throttled" {
  name           = "${var.name}-sign-in-throttled"
  log_group_name = var.api_log_group
  pattern        = "{ $.res.statusCode = 429 }"
  metric_transformation {
    name          = "Throttled"
    namespace     = "Morbeez/${var.name}"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "throttled" {
  alarm_name          = "${var.name}-throttled-spike"
  alarm_description   = "Unusually many requests refused by rate limits - an attack, or limits set too low for real use"
  namespace           = "Morbeez/${var.name}"
  metric_name         = "Throttled"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
}

resource "aws_cloudwatch_metric_alarm" "waf_blocked" {
  alarm_name          = "${var.name}-waf-blocked-spike"
  alarm_description   = "WAF blocking unusually many requests"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = var.waf_name, Region = var.region, Rule = "ALL" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 500
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
}

# ---- Database ----

resource "aws_cloudwatch_metric_alarm" "db" {
  for_each = {
    cpu         = { metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold", desc = "Database CPU above 80% for 15 minutes" }
    memory      = { metric = "FreeableMemory", stat = "Average", threshold = var.db_min_freeable_memory_bytes, op = "LessThanThreshold", desc = "Database free memory low" }
    storage     = { metric = "FreeStorageSpace", stat = "Minimum", threshold = var.db_min_free_storage_bytes, op = "LessThanThreshold", desc = "Database storage running out (autoscaling may be at its ceiling)" }
    connections = { metric = "DatabaseConnections", stat = "Maximum", threshold = var.db_max_connections_alarm, op = "GreaterThanThreshold", desc = "Database connections near the limit - add RDS Proxy before adding API tasks" }
  }
  alarm_name          = "${var.name}-db-${each.key}"
  alarm_description   = each.value.desc
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  dimensions          = { DBInstanceIdentifier = var.db_instance_id }
  statistic           = each.value.stat
  period              = 300
  evaluation_periods  = 3
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  alarm_actions       = local.actions
  ok_actions          = local.actions
}

# ---- Redis ----

resource "aws_cloudwatch_metric_alarm" "redis" {
  for_each = {
    cpu       = { metric = "EngineCPUUtilization", threshold = 75, desc = "Redis engine CPU above 75%" }
    memory    = { metric = "DatabaseMemoryUsagePercentage", threshold = 80, desc = "Redis memory above 80%" }
    evictions = { metric = "Evictions", threshold = 0, desc = "Redis evicting keys - rate-limit counters may be lost" }
  }
  alarm_name          = "${var.name}-redis-${each.key}"
  alarm_description   = each.value.desc
  namespace           = "AWS/ElastiCache"
  metric_name         = each.value.metric
  dimensions          = { ReplicationGroupId = var.redis_replication_group_id }
  statistic           = each.key == "evictions" ? "Sum" : "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.actions
}

# ---- Spend ----

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.alert_emails
  }
}

# ---- Dashboard ----

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = var.name
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title  = "API requests and server errors"
          region = var.region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.api_target_group_arn_suffix],
            [".", "HTTPCode_Target_5XX_Count", ".", ".", ".", ".", { yAxis = "right" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title  = "API latency (p50 / p95 / p99, seconds)"
          region = var.region
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.api_target_group_arn_suffix, { stat = "p50" }],
            ["...", { stat = "p95" }],
            ["...", { stat = "p99" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 8, height = 6
        properties = {
          title  = "Running tasks"
          region = var.region
          stat   = "Average"
          period = 60
          metrics = [
            ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.cluster_name, "ServiceName", "api"],
            ["...", "web"],
          ]
        }
      },
      {
        type = "metric", x = 8, y = 6, width = 8, height = 6
        properties = {
          title  = "Database CPU and connections"
          region = var.region
          period = 60
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_instance_id, { stat = "Average" }],
            [".", "DatabaseConnections", ".", ".", { stat = "Maximum", yAxis = "right" }],
          ]
        }
      },
      {
        type = "metric", x = 16, y = 6, width = 8, height = 6
        properties = {
          title  = "Errors in logs, and rate-limited requests"
          region = var.region
          stat   = "Sum"
          period = 300
          metrics = [
            ["Morbeez/${var.name}", "ApiErrorLogs"],
            [".", "Throttled"],
          ]
        }
      },
    ]
  })
}
