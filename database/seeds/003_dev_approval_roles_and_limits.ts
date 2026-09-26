import { Client } from 'pg';
import * as argon2 from 'argon2';

// Depends on 001_dev_tenant and 002_dev_owner_and_roles. Makes the
// approval framework's own worked example concrete: Owner (unlimited,
// every action type — a wildcard limit row), Operations Manager
// (bounded, purchase orders and vehicle actions), Accountant (bounded,
// the financial-adjustment action types), plus two example approval
// rules so the whole thing is exercisable end to end
// (POST /approval-requests, then approve/reject as the right role) without
// hand-writing SQL. NEVER a production configuration (Constitution VI.5).

const DEV_TENANT_NAME = 'Dev Wholesaler Co.';
const OWNER_EMAIL = 'owner@dev.morbeez.local';

const OPS_MANAGER_EMAIL = 'ops-manager@dev.morbeez.local';
const OPS_MANAGER_PASSWORD = 'dev-only-change-me-123';
const OPS_MANAGER_PERMISSIONS = [
  'vehicles:read',
  'vehicles:write',
  'workforce:read',
  'workforce:write',
  'products:read',
  'products:write',
  'approvals:read',
];

const ACCOUNTANT_EMAIL = 'accountant@dev.morbeez.local';
const ACCOUNTANT_PASSWORD = 'dev-only-change-me-123';
const ACCOUNTANT_PERMISSIONS = ['farmers:read', 'farmers:write', 'customers:read', 'approvals:read'];

const HASH_OPTIONS: argon2.Options & { type: argon2.argon2id } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function ensureRole(client: Client, tenantId: string, name: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO identity.role (tenant_id, name)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [tenantId, name],
  );
  return result.rows[0].id;
}

async function grantPermissions(client: Client, roleId: string, codes: string[]): Promise<void> {
  for (const code of codes) {
    await client.query(
      `INSERT INTO identity.role_permission (role_id, permission_id)
       SELECT $1, id FROM identity.permission WHERE code = $2
       ON CONFLICT DO NOTHING`,
      [roleId, code],
    );
  }
}

async function ensureUser(
  client: Client,
  tenantId: string,
  email: string,
  password: string,
  roleId: string,
): Promise<void> {
  const existing = await client.query(
    `SELECT 1 FROM identity.app_user WHERE tenant_id = $1 AND email = $2`,
    [tenantId, email],
  );
  if (existing.rows.length > 0) return;

  const passwordHash = await argon2.hash(password, HASH_OPTIONS);
  const userResult = await client.query<{ id: string }>(
    `INSERT INTO identity.app_user (tenant_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, email, passwordHash],
  );
  await client.query(`INSERT INTO identity.user_role (user_id, role_id) VALUES ($1, $2)`, [
    userResult.rows[0].id,
    roleId,
  ]);
  console.log(`  Dev login: ${email} / ${password}`);
}

async function setLimit(
  client: Client,
  tenantId: string,
  createdBy: string,
  roleId: string,
  actionType: string | null,
  maxAmount: number | null,
): Promise<void> {
  const conflictTarget = actionType
    ? '(tenant_id, role_id, action_type) WHERE action_type IS NOT NULL'
    : '(tenant_id, role_id) WHERE action_type IS NULL';
  await client.query(
    `INSERT INTO approvals.approval_role_limit (tenant_id, role_id, action_type, max_amount, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ${conflictTarget} DO UPDATE SET max_amount = EXCLUDED.max_amount, updated_at = now()`,
    [tenantId, roleId, actionType, maxAmount, createdBy],
  );
}

export async function seed(client: Client): Promise<void> {
  const tenantResult = await client.query<{ id: string }>(
    `SELECT id FROM tenant.tenant WHERE name = $1 LIMIT 1`,
    [DEV_TENANT_NAME],
  );
  const tenantId = tenantResult.rows[0]?.id;
  if (!tenantId) throw new Error(`${DEV_TENANT_NAME} not found — did 001_dev_tenant run first?`);

  const ownerRole = await client.query<{ id: string }>(
    `SELECT id FROM identity.role WHERE tenant_id = $1 AND name = 'Owner'`,
    [tenantId],
  );
  const ownerUser = await client.query<{ id: string }>(
    `SELECT id FROM identity.app_user WHERE tenant_id = $1 AND email = $2`,
    [tenantId, OWNER_EMAIL],
  );
  if (ownerRole.rows.length === 0 || ownerUser.rows.length === 0) {
    throw new Error('Owner role/user not found — did 002_dev_owner_and_roles run first?');
  }
  const ownerRoleId = ownerRole.rows[0].id;
  const ownerUserId = ownerUser.rows[0].id;

  const opsManagerRoleId = await ensureRole(client, tenantId, 'Operations Manager');
  await grantPermissions(client, opsManagerRoleId, OPS_MANAGER_PERMISSIONS);
  await ensureUser(client, tenantId, OPS_MANAGER_EMAIL, OPS_MANAGER_PASSWORD, opsManagerRoleId);

  const accountantRoleId = await ensureRole(client, tenantId, 'Accountant');
  await grantPermissions(client, accountantRoleId, ACCOUNTANT_PERMISSIONS);
  await ensureUser(client, tenantId, ACCOUNTANT_EMAIL, ACCOUNTANT_PASSWORD, accountantRoleId);

  // Owner: unlimited, every action type — one wildcard row, not one row
  // per action type.
  await setLimit(client, tenantId, ownerUserId, ownerRoleId, null, null);

  // Operations Manager: bounded, specific action types only — no
  // wildcard, so anything not listed here simply isn't approvable by
  // this role (falls through to Owner).
  await setLimit(client, tenantId, ownerUserId, opsManagerRoleId, 'purchase_order', 100000);
  await setLimit(client, tenantId, ownerUserId, opsManagerRoleId, 'vehicle_disposal', 500000);

  // Accountant: bounded, the financial-adjustment action types.
  await setLimit(client, tenantId, ownerUserId, accountantRoleId, 'credit_note', 25000);
  // 0 threshold rules (below) mean "always requires approval" — the
  // Accountant's limit still needs a max_amount; null (unlimited) is
  // reasonable for a person whose whole job is this decision.
  await setLimit(client, tenantId, ownerUserId, accountantRoleId, 'bad_debt_writeoff', null);

  // Example rules — Constitution/Accounting Engine's own approval
  // requirements (CN.4, BD.2), now backed by real thresholds.
  await client.query(
    `INSERT INTO approvals.approval_rule (tenant_id, action_type, threshold_amount, is_active, created_by)
     VALUES ($1, 'purchase_order', 50000, true, $2)
     ON CONFLICT (tenant_id, action_type) DO NOTHING`,
    [tenantId, ownerUserId],
  );
  await client.query(
    `INSERT INTO approvals.approval_rule (tenant_id, action_type, threshold_amount, is_active, created_by)
     VALUES ($1, 'bad_debt_writeoff', 0, true, $2)
     ON CONFLICT (tenant_id, action_type) DO NOTHING`,
    [tenantId, ownerUserId],
  );
}
