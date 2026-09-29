# Disaster recovery

Targets: **RPO** (how much recent data can be lost) and **RTO** (how long
until businesses can trade again).

| What fails | RPO | RTO | What happens |
|---|---|---|---|
| One task or server | 0 | seconds | ECS replaces it; the ALB stops routing to it |
| One availability zone | 0 | 1–2 min | RDS fails over to its synchronous standby; tasks run in the other two AZs; Redis promotes its replica |
| Data corrupted (bug, bad migration, deletion) | to the second, up to 35 days back | 1–2 h | `restore-database.md` |
| **The whole ap-south-1 region** | ~5–15 min | 4 h | this document |
| The AWS account compromised | last backup copy | 1–2 days | backups in locked vaults survive; rebuild in a clean account from Terraform |

## What is already in ap-south-2 (Hyderabad)

- Database: automated backups replicated continuously (point-in-time restore
  there, minutes behind), plus the daily/monthly/yearly AWS Backup copies.
- Uploads: every object replicated to `morbeez-prod-uploads-dr-<account>`.
- Container images: replicated by ECR on push.
- Database secrets: replicated by Secrets Manager.
- Encryption keys: multi-region replicas.

Both regions are in India, so a failover doesn't move tenant data abroad.

## Regional failover

Declare it only when AWS confirms a regional outage expected to outlast the
RTO — a failover and later fail-back each cost hours.

1. **Database** — restore in ap-south-2 from the replicated backups:
   ```sh
   aws rds restore-db-instance-to-point-in-time --region ap-south-2 \
     --source-db-instance-automated-backups-arn <replicated backup ARN> \
     --target-db-instance-identifier morbeez-prod \
     --use-latest-restorable-time --multi-az ...
   ```
2. **Everything else** — apply `environments/prod` with the region variables
   pointing at ap-south-2 and a new state key (the stack is region-agnostic
   apart from those). Import the restored database instead of creating one.
   The replicated secrets and images are already there.
3. **Uploads** — point `UPLOADS_BUCKET` at the DR bucket (it becomes primary).
4. **Traffic** — the Route 53 records follow the new load balancer on apply.
   Drivers' apps and owners' browsers reconnect by themselves; signed-in
   sessions survive (they live in the database).
5. **Tell tenants** what window of data may be missing (from the restore
   time), and to check any cash recorded in that window.

Rehearse this once a year in the staging account, end to end, with a stopwatch.

## Fail-back

When ap-south-1 is healthy: the same steps in reverse, in a planned
maintenance window, with a fresh backup taken first.
