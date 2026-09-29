# Deploying and rolling back

## Normal release

Merge to `main`. CI runs; if it is green, CD:

1. builds the API, migration and owner-app images once, tagged with the commit;
2. **staging**: pushes them, runs migrations, rolls out, smoke-tests;
3. waits for a reviewer to approve the `production` environment;
4. **production**: pushes the *same* images and repeats step 2.

A rollout replaces tasks gradually (new ones start beside the old, take
traffic only when healthy). ECS rolls back by itself if new tasks fail their
health checks, or if the API error rate passes 2% or its p95 passes 1.5 s
while the rollout runs. The pipeline then fails and says so.

## Migrations must be backward-compatible (Constitution III.6, VII.3)

Migrations run *before* the new code, while the old code is still serving.
So a migration may only **expand**: add a table, add a nullable column, add
an index (`CONCURRENTLY` for big tables). Removing or renaming something is
a second release, after no running code uses it. A migration that breaks the
running release is a production incident even if the new code would be fine.

Migrations run as the database owner, which on RDS is **not** a superuser. If
a migration writes data into a table with `FORCE ROW LEVEL SECURITY`, lift
FORCE around that statement (see `20261008080000_create-india-tax-layer.js`).
CI migrates as a non-superuser owner, so it catches this.

## Rolling back

The code: Actions → CD → Run workflow → `tag` = the last good commit SHA. It
redeploys those images (still in ECR; tags are immutable) through staging and
production. Takes ~10 minutes plus approval.

The schema is **not** rolled back: the previous release works with the new
schema, because migrations only expand. Never run `migrate down` in
production — a `down` that drops a column drops its data.

If a migration itself damaged data, follow `restore-database.md`.

## Hotfix

Same path as any change (Constitution VII.1): a branch, CI, merge, CD. For a
genuine emergency the reviewer approves production immediately; there is no
manual deploy.
