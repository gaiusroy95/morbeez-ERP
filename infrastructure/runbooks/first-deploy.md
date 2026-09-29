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
- Open `https://app.<domain>/login`. Create the first business through signup;
  **never run `database/seeds` against production** — they create dev users with
  a published password.

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
