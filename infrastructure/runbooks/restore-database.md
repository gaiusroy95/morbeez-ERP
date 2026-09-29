# Restoring the database

For when data is wrong or gone: a bad migration, a bug that corrupted rows,
an accidental delete. (Losing the database *server* is handled by RDS
Multi-AZ failover automatically; losing the *region* is `disaster-recovery.md`.)

The rule: **restore beside, never over.** A restore always creates a new
instance; production keeps running until you decide what to do.

## 1. Find the moment before the damage

From logs, the audit log (`infra.audit_log`, every change with who and when)
or the release time. Point-in-time recovery reaches any second in the last
35 days (RDS automated backups); older points use the daily, monthly or
yearly backups in the AWS Backup vault.

## 2. Restore a copy

```sh
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier morbeez-prod \
  --target-db-instance-identifier morbeez-prod-restore-<date> \
  --restore-time 2026-10-14T03:59:00Z \
  --db-subnet-group-name morbeez-prod \
  --vpc-security-group-ids <database security group> \
  --db-parameter-group-name morbeez-prod-pg16 \
  --no-publicly-accessible
aws rds wait db-instance-available --db-instance-identifier morbeez-prod-restore-<date>
```

Budget 20–40 minutes for a database of up to ~100 GB (the monthly drill
measures it).

## 3. Decide

- **A few tenants or tables damaged** (the usual case): copy the right rows
  from the restored instance into production, inside a transaction, as
  *new* ledger entries where money is involved — the ledger is append-only
  (Constitution III.3). Work from a one-off ECS task in the VPC, never from a
  laptop.
- **Everything damaged**: switch the application to the restored instance.
  Put its address into the `app-url` and `owner-url` secrets, redeploy the
  current release (the tasks read secrets at start), then rename instances
  so Terraform owns the right one (`terraform import` / `state mv`). Writes
  made between the restore point and the switch are lost — say exactly which
  in the incident notes.

## 4. Clean up

Delete the restore instance when done (`--skip-final-snapshot` is fine; the
original backups are untouched).
