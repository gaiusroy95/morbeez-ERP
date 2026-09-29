#!/usr/bin/env bash
# Monthly restore drill (Constitution VII.7: restores are rehearsed, not
# assumed). Restores production's latest restorable point to a temporary
# instance, checks it inside the VPC, reports the time it took and how
# recent the data is, and deletes it again. The copy never serves traffic.
#
# Required environment: NAME (morbeez-prod), CLUSTER, SUBNETS,
# SECURITY_GROUP, DB_SECURITY_GROUP, SOURCE_DB (instance id).
set -euo pipefail
: "${NAME:?}" "${CLUSTER:?}" "${SUBNETS:?}" "${SECURITY_GROUP:?}" "${DB_SECURITY_GROUP:?}" "${SOURCE_DB:?}"

DRILL="$NAME-drill-$(date -u +%Y%m%d%H%M)"
START=$(date -u +%s)
summary() { echo "$*" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"; }

cleanup() {
  aws rds delete-db-instance --db-instance-identifier "$DRILL" --skip-final-snapshot --delete-automated-backups > /dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Restoring $SOURCE_DB to $DRILL"
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier "$SOURCE_DB" \
  --target-db-instance-identifier "$DRILL" \
  --use-latest-restorable-time \
  --db-subnet-group-name "$NAME" \
  --vpc-security-group-ids "$DB_SECURITY_GROUP" \
  --db-parameter-group-name "$NAME-pg16" \
  --db-instance-class db.t4g.large \
  --no-multi-az --no-publicly-accessible --no-deletion-protection \
  --tags Key=Purpose,Value=restore-drill > /dev/null
aws rds wait db-instance-available --db-instance-identifier "$DRILL"
RESTORED=$(date -u +%s)
HOST=$(aws rds describe-db-instances --db-instance-identifier "$DRILL" --query 'DBInstances[0].Endpoint.Address' --output text)

echo "Verifying the restored copy"
TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$NAME-migrate" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"migrate\",\"command\":[\"node\",\"../../database/scripts/verify-restore.js\"],\"environment\":[{\"name\":\"DRILL_HOST\",\"value\":\"$HOST\"}]}]}" \
  --started-by restore-drill --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
EXIT=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
RESULT=$(aws logs get-log-events --log-group-name "/$NAME/migrate" --log-stream-name "migrate/migrate/${TASK##*/}" \
  --query 'events[-1].message' --output text 2>/dev/null || echo '{}')

summary "## Restore drill $(date -u +%F)"
summary "- Time to a usable database: $(( (RESTORED - START) / 60 )) minutes (RDS restore; the RTO budget is 60)"
summary "- Verification: \`$RESULT\`"
[ "$EXIT" = "0" ] || { summary "- **FAILED** - see the problems above"; exit 1; }
summary "- Passed"
