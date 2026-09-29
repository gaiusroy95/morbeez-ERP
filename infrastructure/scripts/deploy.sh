#!/usr/bin/env bash
# Deploys one image tag (a commit SHA) to one environment. Run by the CD
# workflow with AWS credentials for that environment already in place; also
# usable by hand in an emergency, though Constitution VII.1 wants every
# production change to go through the pipeline.
#
#   1. register task definitions for api, web and migrate using the new images
#   2. run the migration task and require exit code 0 (Constitution VII.3 —
#      migrations are expand/contract, so the code still running keeps working)
#   3. roll out api and web; ECS rolls back by itself on failed health checks
#      or on the error/latency alarms (Constitution VII.4)
#   4. smoke-test the public endpoints
#
# Required environment: NAME (e.g. morbeez-prod), CLUSTER, TAG, REGISTRY,
# SUBNETS (comma-separated), SECURITY_GROUP, API_URL, WEB_URL.
set -euo pipefail

: "${NAME:?}" "${CLUSTER:?}" "${TAG:?}" "${REGISTRY:?}" "${SUBNETS:?}" "${SECURITY_GROUP:?}" "${API_URL:?}" "${WEB_URL:?}"

log() { printf '\n==> %s\n' "$*"; }

# A new revision of a task definition family with only the image changed.
register() {
  local family=$1 image=$2
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json \
    | jq --arg image "$image" '
        .containerDefinitions[0].image = $image
        | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
    > /tmp/taskdef.json
  aws ecs register-task-definition --cli-input-json file:///tmp/taskdef.json --query taskDefinition.taskDefinitionArn --output text
}

log "Registering task definitions for $TAG"
MIGRATE_TD=$(register "$NAME-migrate" "$REGISTRY/$NAME/migrate:$TAG")
API_TD=$(register "$NAME-api" "$REGISTRY/$NAME/api:$TAG")
WEB_TD=$(register "$NAME-web" "$REGISTRY/$NAME/web:$TAG")

log "Running migrations ($MIGRATE_TD)"
TASK=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$MIGRATE_TD" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --started-by "deploy-$TAG" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
EXIT=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)
TASK_ID=${TASK##*/}
aws logs get-log-events --log-group-name "/$NAME/migrate" --log-stream-name "migrate/migrate/$TASK_ID" \
  --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' | tail -50 || true
if [ "$EXIT" != "0" ]; then
  echo "Migrations failed (exit code $EXIT). Nothing was rolled out; the running release is untouched." >&2
  exit 1
fi

log "Rolling out api and web"
aws ecs update-service --cluster "$CLUSTER" --service api --task-definition "$API_TD" --query 'service.serviceName' --output text
aws ecs update-service --cluster "$CLUSTER" --service web --task-definition "$WEB_TD" --query 'service.serviceName' --output text

# services-stable returns once the deployment settles — either finished, or
# rolled back to the previous revision. Only the first counts as success.
for service in api web; do
  aws ecs wait services-stable --cluster "$CLUSTER" --services "$service" || true
  STATE=$(aws ecs describe-services --cluster "$CLUSTER" --services "$service" \
    --query 'services[0].deployments[?status==`PRIMARY`].rolloutState | [0]' --output text)
  RUNNING=$(aws ecs describe-services --cluster "$CLUSTER" --services "$service" \
    --query 'services[0].deployments[?status==`PRIMARY`].taskDefinition | [0]' --output text)
  expected=$API_TD
  [ "$service" = web ] && expected=$WEB_TD
  if [ "$STATE" != "COMPLETED" ] || [ "$RUNNING" != "$expected" ]; then
    echo "$service did not roll out cleanly (state $STATE, running $RUNNING) - ECS rolled it back." >&2
    exit 1
  fi
done

log "Smoke tests"
curl -fsS --retry 5 --retry-delay 5 "$API_URL/health/ready" > /dev/null
curl -fsS --retry 5 --retry-delay 5 -o /dev/null "$WEB_URL/login"
echo "Deployed $TAG to $NAME."
