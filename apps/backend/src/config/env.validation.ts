import { z } from 'zod';

// The process refuses to boot on an invalid environment rather than failing
// confusingly later inside a request handler — validated once, at startup,
// and the validated result is what the rest of the app reads (never
// process.env directly).
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    // Owner-privileged — DDL, used only by node-pg-migrate and
    // database/seeds/ (both outside this process). The running
    // application itself never connects with this.
    DATABASE_URL: z.string().url(),

    // What DatabaseService actually connects with — the morbeez_app role,
    // DML-only, genuinely subject to Row-Level Security (Production
    // Database, Section 01; database/migrations,
    // create-app-runtime-role). Tenant isolation depends on this being a
    // different, weaker credential than DATABASE_URL, not the same one
    // reused.
    APP_DATABASE_URL: z.string().url(),

    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(16),
    EVENT_BUS_BROKERS: z.string().optional(),

    // Symmetric key for pgcrypto's pgp_sym_encrypt/pgp_sym_decrypt —
    // Farmers' bank_details column is encrypted at rest with it
    // (Constitution V.4). Passed as a query parameter at call time, never
    // interpolated into SQL. A real value comes from the secrets manager
    // in every environment but local dev, same as JWT_SECRET.
    FIELD_ENCRYPTION_KEY: z.string().min(16),

    // Logging (Constitution VII.6 — observability ships with the feature).
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // CORS: comma-separated origin list. Optional in dev/test (defaults to
    // the owner-app's local port); required in production — see the
    // cross-field check below, so an empty/unset value there fails loud at
    // boot instead of silently allowing every origin.
    CORS_ORIGIN: z.string().optional(),

    // API documentation (Constitution IV.1) — on by default; the deploy
    // pipeline is what should turn it off in production if that's ever
    // the policy, not a code change.
    API_DOCS_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),

    // Database pool sizing — conservative defaults for a single small
    // instance; production tunes this per the managed RDS instance class.
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  })
  // Order matters: check the raw (pre-default) value first, so production's
  // requirement can't be satisfied by the default that's about to be
  // applied — then, and only for non-production, fill it in.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGIN?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN is required in production — it must not fall back to a default.',
      });
    }
  })
  .transform((env) => ({
    ...env,
    CORS_ORIGIN: env.CORS_ORIGIN ?? 'http://localhost:3001',
  }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return result.data;
}
