# Incident response

## Severity

| Sev | Meaning | Examples | Response |
|---|---|---|---|
| 1 | Businesses can't trade, or money/data is wrong or exposed | API down; ledger entries not balancing; a tenant seeing another's data; backups failing *and* a restore needed | Page now, all hands, customer update within 30 min |
| 2 | Trading degraded | Order confirmation slow in the morning rush; driver sync failing; one module down | Page on-call, fix today |
| 3 | Annoyance, workaround exists | A report slow; one alarm flapping | Next working day |

Every Sev 1 and Sev 2 gets a written, blameless postmortem within five
working days: timeline, root cause, what changes (Constitution VII.8).

## Where to look

1. **Dashboard** `morbeez-prod` (CloudWatch): requests and errors, latency,
   running tasks, database CPU/connections, error logs and throttling.
2. **Logs** — CloudWatch Logs Insights, group `/morbeez-prod/api`. Every line
   is JSON with `req.id` (the `request_id` users see in error messages),
   `tenantId`, `res.statusCode`, `responseTime`.

   ```
   # one request, from the id in a user's screenshot
   fields @timestamp, msg, err.message | filter req.id = "<id>" or requestId = "<id>"

   # errors in the last hour, by message
   filter level >= 50 | stats count() by msg, err.message | sort count() desc

   # slowest endpoints for one tenant
   filter tenantId = "<tenant uuid>" | stats pct(responseTime, 95) as p95, count() by req.url | sort p95 desc | limit 20
   ```
3. **Database** — RDS Performance Insights (top SQL by load), and the
   `postgresql` log group for statements over 500 ms and lock waits.
4. **Recent changes** — the last CD run. If trouble started with a release,
   roll back first and investigate second (`deploy-and-rollback.md`).

## Common situations

- **API 5xx rising after a deploy** — ECS should already be rolling back; if
  the deploy had finished, redeploy the previous SHA.
- **Database connections near the limit** — API tasks × `DATABASE_POOL_MAX`
  is the ceiling. Lower the API maximum tasks, or put RDS Proxy in front
  (`scaling` section of the deployment plan).
- **Lots of 429s** — check whether it's one address (WAF logs,
  `aws-waf-logs-morbeez-prod`) or everyone (limits too low for a real
  surge, e.g. drivers behind one mobile carrier address — raise
  `LOGIN_ATTEMPTS_PER_IP_PER_MINUTE`).
- **One tenant says they see wrong data** — treat as Sev 1 until proven
  otherwise; capture request ids before anything is changed.
- **Redis down** — rate limits fall back to per-task memory (weaker, still
  on); nothing else depends on it. Sev 2.
