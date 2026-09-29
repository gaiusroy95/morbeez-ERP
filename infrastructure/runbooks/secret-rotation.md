# Rotating secrets

All secrets live in Secrets Manager under `morbeez-prod/…` and reach tasks
as environment variables at start-up, so a rotation takes effect on the next
deploy (Actions → CD → Run with the current SHA restarts every task).

Rotate on a schedule (yearly), when someone with access leaves, and at once
if one may have leaked (Constitution V.3: a leaked secret is compromised).

| Secret | How | Effect on users |
|---|---|---|
| `app/jwt-secret` | Put a new random value; redeploy | None visible: access tokens (15 minutes) signed with the old secret stop verifying, and the apps quietly refresh them — refresh tokens live in the database, not the JWT |
| `database/app-password` + `app-url` | `ALTER ROLE morbeez_app PASSWORD '…'` as the owner, update both secrets, redeploy | None if done in that order within a deploy |
| `database/owner-url` | Change the master password in RDS, update the secret | None (only migrations use it) |
| `redis-url` | Set a new auth token on the replication group (`--auth-token-update-strategy ROTATE`), update the secret, redeploy, then `SET` | None |
| `app/field-encryption-key` | **Do not simply change it.** It encrypts farmers' bank details; a new key makes them unreadable. Re-encrypt every row with the new key in one migration (decrypt with old, encrypt with new), then switch | None if done right |

Terraform generated the initial values and then ignores them, so an apply
never reverts a rotation (it only manages that the secret exists).
