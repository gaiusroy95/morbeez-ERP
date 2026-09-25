import { validateEnv } from './env.validation';

// Typed environment configuration, validated once at boot (env.validation.ts).
// Secrets are injected at runtime from the secrets manager in every
// environment but local dev (Constitution V.3) — never committed here.
export default () => validateEnv(process.env);
