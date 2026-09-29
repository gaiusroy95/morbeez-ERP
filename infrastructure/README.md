# Infrastructure

Everything that runs Morbeez in AWS, as code (Constitution VII.2 — no console
changes to production outside a declared incident).

```
terraform/
  modules/        network · database · cache · storage · compute · observability · backup · cicd
                  (event-bus: not provisioned until the outbox is real — see its main.tf)
  environments/   dev · staging · prod — one AWS account each (CLOUD.4)
scripts/
  deploy.sh         register images, run migrations, roll out, smoke-test (used by CD)
  restore-drill.sh  monthly: restore production's latest backup, verify, delete
runbooks/         first deploy · deploy and roll back · incidents · restoring the database ·
                  disaster recovery · rotating secrets
```

## Shape of production

ap-south-1 (Mumbai) across three availability zones; disaster-recovery copies
in ap-south-2 (Hyderabad), so tenant data stays in India.

- **Edge**: Route 53 → WAF → Application Load Balancer, the only public entry
  point. `app.<domain>` is the owner app, `api.<domain>` the API (and the
  driver app's endpoint).
- **Compute**: ECS Fargate — `api` (NestJS) and `web` (Next.js); the owner app
  reaches the API privately through Service Connect. A one-off `migrate`
  task runs before every rollout.
- **Data**: RDS PostgreSQL 16 Multi-AZ (35-day point-in-time recovery,
  backups replicated to Hyderabad); ElastiCache Redis with a replica (rate
  limits); S3 for uploads (versioned, replicated).
- **Secrets**: Secrets Manager; tasks receive only the ones they need. The
  API never gets the database owner's credentials.

The full reasoning — SLOs, RPO/RTO, scaling steps, costs — is in the
deployment plan document.

## Everyday commands

```sh
cd terraform/environments/prod
terraform init
terraform plan  -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars
```

`prod.tfvars` holds `domain_name`, `hosted_zone_id`, `image_tag`,
`github_repository`, `alert_emails`; it contains no secrets (those are
generated into Secrets Manager).
