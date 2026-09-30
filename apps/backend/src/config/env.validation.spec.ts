import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Env, validateEnv } from './env.validation';

const BASE = {
  APP_DATABASE_URL: 'postgres://app@localhost:5432/morbeez',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  FIELD_ENCRYPTION_KEY: 'y'.repeat(32),
};

describe('validateEnv', () => {
  it('turns flags into booleans and numbers into numbers', () => {
    const env = validateEnv({ ...BASE, SIGNUP_ENABLED: 'false', API_DOCS_ENABLED: 'false', DATABASE_POOL_MAX: '25' });
    expect(env.SIGNUP_ENABLED).toBe(false);
    expect(env.API_DOCS_ENABLED).toBe(false);
    expect(env.DATABASE_POOL_MAX).toBe(25);
  });

  it('keeps signup and API docs off in production unless set', () => {
    const env = validateEnv({ ...BASE, NODE_ENV: 'production', CORS_ORIGIN: 'https://app.morbeez.in' });
    expect(env.SIGNUP_ENABLED).toBe(false);
    expect(env.API_DOCS_ENABLED).toBe(false);
    expect(validateEnv(BASE).SIGNUP_ENABLED).toBe(true);
  });
});

// ConfigService.get() reads the validated env before raw process.env. When
// validateEnv was wired in with `load` instead of `validate`, SIGNUP_ENABLED
// set to "false" came back as the truthy string "false", and signup stayed open.
describe('ConfigService wiring', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('returns the parsed value, not the raw environment string', async () => {
    Object.assign(process.env, BASE, { SIGNUP_ENABLED: 'false', API_DOCS_ENABLED: 'false', DATABASE_POOL_MAX: '25' });
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, validate: validateEnv })],
    }).compile();
    const config = moduleRef.get<ConfigService<Env, true>>(ConfigService);
    expect(config.get('SIGNUP_ENABLED', { infer: true })).toBe(false);
    expect(config.get('API_DOCS_ENABLED', { infer: true })).toBe(false);
    expect(config.get('DATABASE_POOL_MAX', { infer: true })).toBe(25);
  });
});
