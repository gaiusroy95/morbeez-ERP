# First deploy of an environment

Once per environment (staging first, then production). Everything after this
goes through the CD pipeline.

## 1. Accounts and state (by hand, once)

1. One AWS account per environment — dev, staging, prod (CLOUD.4) — under an
   AWS Organization with SSO; no IAM users with keys.
2. In the new account, create the Terraform state bucket and lock table named
   in `environments/<env>/backend.tf`:
   - S3 bucket: versioning on, default encryption (SSE-KMS), public access
     blocked.
   - DynamoDB table: partition key `LockID` (string), on-demand.
3. Register the domain (or delegate a subdomain) to a Route 53 hosted zone in
   that account; note the zone id.

## 2. Images before infrastructure

The services start with whatever tag Terraform is given, so the images must
exist first. Apply only the registries, then push one build by hand:

```sh
cd infrastructure/terraform/environments/prod
terraform init
terraform apply -target=module.compute.aws_ecr_repository.this \
  -var domain_name=morbeez.in -var hosted_zone_id=Z123 -var image_tag=bootstrap \
  -var github_repository=owner/repo -var 'alert_emails=["ops@example.com"]'
# then from the repository root, for the commit you're launching:
TAG=$(git rev-parse HEAD)
docker build -f apps/backend/Dockerfile --target runtime -t <registry>/morbeez-prod/api:$TAG .
docker build -f apps/backend/Dockerfile --target migrate -t <registry>/morbeez-prod/migrate:$TAG .
docker build -f apps/owner-app/Dockerfile -t <registry>/morbeez-prod/web:$TAG .
docker push ...   # all three
```

## 3. Everything else

```sh
terraform apply -var image_tag=$TAG ...   # same variables as above
```

Takes 30–45 minutes (the database and its standby are most of it). Then:

- Confirm the SNS subscription emails.
- Run the migration task once by hand (it is the pipeline's job from now on):
  `NAME=morbeez-prod CLUSTER=morbeez-prod TAG=$TAG ... bash infrastructure/scripts/deploy.sh`
  with the variables from `terraform output`.
- **Never run `database/seeds` against production.** They create dev users with
  a published password.

## 4a. Onboarding a business (pilot: invite-only)

Public signup is off in staging and production (`SIGNUP_ENABLED=false` in the
API task; `POST /tenants` answers 403). The team creates each business as a
one-off task on the API's own task definition, which already has the database
secret and network access:

```sh
aws ecs run-task --cluster morbeez-prod --launch-type FARGATE \
  --task-definition morbeez-prod-api \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","dist/src/cli/provision-tenant.js","Sharma Vegetables","owner@sharmaveg.in"]}]}'
```

The task prints one JSON line to the API log group:
`{"tenantId":…,"business":…,"ownerEmail":…,"oneTimePassword":…}`. It creates
the tenant, chart of accounts, Owner role and owner login in one transaction.
An email that already has a login is refused, and nothing is created.

- Give the one-time password to the owner **by phone**, never by email or chat.
- At first sign-in, the owner changes it from the menu: **You → Your account →
  Change password**. That signs them out everywhere. The same day, confirm they
  have done it. The old password is still in the log line, so until it is
  changed, anyone who can read the logs can sign in.

To open signup later, set `SIGNUP_ENABLED=true` in the API task definition
(`modules/compute/main.tf`) and deploy.

## 4. Hand over to the pipeline

In GitHub → Settings → Environments:

| Environment | Variables | Protection |
|---|---|---|
| `staging` | `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `ECS_SUBNETS` (comma-separated), `ECS_SECURITY_GROUP`, `API_URL`, `WEB_URL` | none |
| `production` | the same, from the production account | required reviewers; `main` only |
| `production-drill` | `AWS_DRILL_ROLE_ARN`, `ECS_SUBNETS`, `ECS_SECURITY_GROUP`, `DB_SECURITY_GROUP` | `main` only |

All values come from `terraform output`. From here, merging to `main` deploys.

## 5. Before the first real tenant

- Run the dispatch-hour load test against staging (Testing Strategy AT.7).
- Run the restore drill once by hand (Actions → Restore drill → Run).
- Walk through `disaster-recovery.md` with whoever will be on call.
