import { Client } from 'pg';
import * as argon2 from 'argon2';

// Depends on 001_dev_tenant (runs first — filename order). Seeds a
// standard "Owner" role carrying every permission seeded so far, and one
// dev login so the auth flow is actually exercisable end to end without
// hand-writing SQL. NEVER a production credential — the point of this
// file is a working `pnpm db:seed` locally, nothing else (Constitution
// VI.5).

const DEV_TENANT_NAME = 'Dev Wholesaler Co.';
const OWNER_EMAIL = 'owner@dev.morbeez.local';
const OWNER_PASSWORD = 'dev-only-change-me-123';

// Must match apps/backend/src/modules/users/security/password.service.ts —
// duplicated here because the seed script runs outside the Nest DI
// container, not because the policy is meant to diverge.
const HASH_OPTIONS: argon2.Options & { type: argon2.argon2id } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function seed(client: Client): Promise<void> {
  const tenantResult = await client.query<{ id: string }>(
    `SELECT id FROM tenant.tenant WHERE name = $1 LIMIT 1`,
    [DEV_TENANT_NAME],
  );
  const tenantId = tenantResult.rows[0]?.id;
  if (!tenantId) {
    throw new Error(
      `${DEV_TENANT_NAME} not found — did 001_dev_tenant run first?`,
    );
  }

  // The seed script connects as the migration-owning role, which bypasses
  // RLS by default (documented gap — see the identity-tables migration).
  // Plain INSERTs work here for exactly that reason; the application
  // itself never gets this shortcut.

  const roleResult = await client.query<{ id: string }>(
    `INSERT INTO identity.role (tenant_id, name)
     VALUES ($1, 'Owner')
     ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantId],
  );
  const ownerRoleId = roleResult.rows[0].id;

  const permissions = await client.query<{ id: string }>(
    `SELECT id FROM identity.permission`,
  );
  for (const permission of permissions.rows) {
    await client.query(
      `INSERT INTO identity.role_permission (role_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ownerRoleId, permission.id],
    );
  }

  const existingUser = await client.query(
    `SELECT 1 FROM identity.app_user WHERE tenant_id = $1 AND email = $2`,
    [tenantId, OWNER_EMAIL],
  );
  if (existingUser.rows.length > 0) return;

  const passwordHash = await argon2.hash(OWNER_PASSWORD, HASH_OPTIONS);
  const userResult = await client.query<{ id: string }>(
    `INSERT INTO identity.app_user (tenant_id, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [tenantId, OWNER_EMAIL, passwordHash],
  );

  await client.query(
    `INSERT INTO identity.user_role (user_id, role_id) VALUES ($1, $2)`,
    [userResult.rows[0].id, ownerRoleId],
  );

  console.log(`  Dev login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
}
