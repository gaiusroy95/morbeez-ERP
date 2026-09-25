import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Env } from '../../config/env.validation';

// Thin wrapper over a pg.Pool, not an ORM — Row-Level Security, triggers,
// and CHECK constraints are load-bearing (Constitution III), and a heavy
// ORM's abstraction fights all three more than it helps. Connects as
// morbeez_app (APP_DATABASE_URL) — DML-only, genuinely subject to RLS
// (database/migrations, create-app-runtime-role) — never as the
// migration-owning role. Every tenant-scoped query must go through
// withTenant() so the RLS session variable is always set (Constitution
// III.1) — there is no other supported way to get a client out of this
// service.
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    this.pool = new Pool({
      connectionString: this.config.get('APP_DATABASE_URL', { infer: true }),
      max: this.config.get('DATABASE_POOL_MAX', { infer: true }),
    });

    this.pool.on('error', (err) => {
      // A background/idle client error — must be logged, never thrown,
      // or it takes down the whole process for an error nothing was
      // awaiting (a well-known pg.Pool footgun).
      this.logger.error('Unexpected idle client error', err.stack);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Untenanted query — for the small, named set of legitimately global
   * reads: the two SECURITY DEFINER lookups (login, refresh-token) and the
   * tenant table itself, which carries no tenant_id because it IS the
   * tenant. Every other table is RLS-protected and FORCE-enabled, so an
   * untenanted query against one of them returns zero rows rather than an
   * error (Postgres's normal RLS behavior) — that's the fail-closed
   * property the isolation tests in test/integration prove directly.
   */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  /**
   * A plain transaction with no tenant context set — for the one flow that
   * genuinely needs it: creating a brand new tenant, where the tenant_id
   * doesn't exist until the first statement inside the transaction creates
   * it. Reach for withTenant() instead unless you're building exactly that
   * flow.
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Sets the RLS session variable on an already-open client, for the same
   * transaction-creates-a-tenant flow transaction() exists for — call this
   * once the new tenant's id is known, then continue issuing queries on
   * the same client as normal.
   */
  setTenantContext(client: PoolClient, tenantId: string): Promise<unknown> {
    return client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
  }

  /**
   * Runs `work` inside a transaction with the RLS session variable set to
   * `tenantId` for its whole duration — every query the caller issues is
   * automatically scoped by Postgres itself (Production Database, Section
   * 01), not by an app-layer WHERE clause someone could forget.
   */
  async withTenant<T>(
    tenantId: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(async (client) => {
      await this.setTenantContext(client, tenantId);
      return work(client);
    });
  }

  async isHealthy(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }
}
