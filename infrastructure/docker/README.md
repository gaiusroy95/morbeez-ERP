# Docker

Local-development container definitions only (Postgres, Redis, a
Kafka-protocol broker) so the stack can run without touching AWS. Production
images are built by CI and pushed to ECR (Constitution VII.1) — this folder
is not the production image build.
