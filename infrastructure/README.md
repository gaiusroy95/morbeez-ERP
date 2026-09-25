# Infrastructure

Terraform, one environment per isolated AWS account/project
(`environments/dev|staging|prod`), composed from shared modules
(`modules/`) — network, database, cache, event-bus, compute, storage,
observability. Every change goes through version-controlled IaC and review;
no console-driven changes to production infrastructure (Constitution VII.2).

See the System Architecture document, Section 09, and the Technology Stack
document, Section 05, for the reasoning behind each module's choice.
