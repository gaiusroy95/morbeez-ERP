import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../src/infra/database/database.service';
import { UsersRepository } from '../../src/modules/users/repositories/users.repository';
import { Env } from '../../src/config/env.validation';

// This suite is the actual proof, not documentation of intent: it connects
// to a real Postgres as morbeez_app — the same restricted, non-owner,
// non-superuser role the running application uses (database/migrations,
// create-app-runtime-role) — and shows that Row-Level Security genuinely
// blocks cross-tenant reads for that connection. Run via
// `pnpm test:integration`, which requires DATABASE_URL and
// APP_DATABASE_URL against a migrated database (see .github/workflows/ci.yml,
// job test-tenant-isolation).

function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    APP_DATABASE_URL: process.env.APP_DATABASE_URL,
    DATABASE_POOL_MAX: 5,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('Tenant isolation (Row-Level Security)', () => {
  let ownerPool: Pool; // fixture setup/teardown only — the migration-owning role, which legitimately bypasses RLS
  let appDb: DatabaseService; // what's actually under test — the restricted runtime role
  let usersRepo: UsersRepository;

  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let userBId: string;

  const EMAIL_A = 'a-user@isolation-test.local';
  const EMAIL_B = 'b-user@isolation-test.local';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_URL) {
      throw new Error(
        'DATABASE_URL and APP_DATABASE_URL must be set to run this suite — see database/migrations/create-app-runtime-role.',
      );
    }

    ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
    appDb = new DatabaseService(fakeConfig());
    appDb.onModuleInit();
    usersRepo = new UsersRepository(appDb);

    const tenantA = await ownerPool.query<{ id: string }>(
      `INSERT INTO tenant.tenant (name) VALUES ('Isolation Test Tenant A') RETURNING id`,
    );
    tenantAId = tenantA.rows[0].id;
    const tenantB = await ownerPool.query<{ id: string }>(
      `INSERT INTO tenant.tenant (name) VALUES ('Isolation Test Tenant B') RETURNING id`,
    );
    tenantBId = tenantB.rows[0].id;

    const userA = await ownerPool.query<{ id: string }>(
      `INSERT INTO identity.app_user (tenant_id, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
      [tenantAId, EMAIL_A],
    );
    userAId = userA.rows[0].id;
    const userB = await ownerPool.query<{ id: string }>(
      `INSERT INTO identity.app_user (tenant_id, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
      [tenantBId, EMAIL_B],
    );
    userBId = userB.rows[0].id;
  });

  afterAll(async () => {
    // app_user references tenant with ON DELETE RESTRICT (Constitution
    // III) — users first, tenants second, or this cleanup fails outright.
    await ownerPool.query(`DELETE FROM identity.app_user WHERE id = ANY($1)`, [
      [userAId, userBId],
    ]);
    await ownerPool.query(`DELETE FROM tenant.tenant WHERE id = ANY($1)`, [
      [tenantAId, tenantBId],
    ]);
    await ownerPool.end();
    await appDb.onModuleDestroy();
  });

  describe('direct queries, scoped as the restricted runtime role', () => {
    it("a query scoped to Tenant A never returns Tenant B's rows", async () => {
      const result = await appDb.withTenant(tenantAId, (client) =>
        client.query<{ email: string }>('SELECT email FROM identity.app_user'),
      );
      const emails = result.rows.map((r) => r.email);
      expect(emails).toContain(EMAIL_A);
      expect(emails).not.toContain(EMAIL_B);
    });

    it("a query scoped to Tenant B never returns Tenant A's rows", async () => {
      const result = await appDb.withTenant(tenantBId, (client) =>
        client.query<{ email: string }>('SELECT email FROM identity.app_user'),
      );
      const emails = result.rows.map((r) => r.email);
      expect(emails).toContain(EMAIL_B);
      expect(emails).not.toContain(EMAIL_A);
    });

    it('fails closed: no tenant context set returns zero rows, not everything and not an error', async () => {
      const result = await appDb.query<{ id: string }>(
        'SELECT id FROM identity.app_user WHERE email = $1',
        [EMAIL_A],
      );
      expect(result.rows).toHaveLength(0);
    });

    it('a tenant id that exists but is not the caller returns zero rows, even addressed by exact primary key', async () => {
      // The strongest single check: ask for User A by their precise id
      // while scoped as Tenant B. Addressing a row exactly is supposed to
      // make no difference — RLS filters before the WHERE clause sees it.
      const result = await appDb.withTenant(tenantBId, (client) =>
        client.query('SELECT id FROM identity.app_user WHERE id = $1', [userAId]),
      );
      expect(result.rows).toHaveLength(0);
    });

    it('a well-formed but nonexistent tenant id returns zero rows, never falls back to "all tenants"', async () => {
      const bogusTenantId = '00000000-0000-0000-0000-000000000000';
      const result = await appDb.withTenant(bogusTenantId, (client) =>
        client.query('SELECT id FROM identity.app_user'),
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('UsersRepository (through the application layer, not raw SQL)', () => {
    it('list() for Tenant A never includes a Tenant B user', async () => {
      const users = await usersRepo.list(tenantAId);
      expect(users.some((u) => u.email === EMAIL_A)).toBe(true);
      expect(users.some((u) => u.email === EMAIL_B)).toBe(false);
    });

    it("findById() cannot fetch another tenant's user even by its real id", async () => {
      const found = await usersRepo.findById(tenantBId, userAId);
      expect(found).toBeNull();
    });
  });

  describe('the login lookup (the one sanctioned untenanted read)', () => {
    it('finds the right user, with the right tenant, regardless of any ambient context', async () => {
      const user = await usersRepo.findByEmailForLogin(EMAIL_A);
      expect(user).not.toBeNull();
      expect(user?.tenantId).toBe(tenantAId);
    });

    it('returns null for an email that belongs to no tenant, rather than throwing', async () => {
      const user = await usersRepo.findByEmailForLogin('nobody@isolation-test.local');
      expect(user).toBeNull();
    });
  });
});
