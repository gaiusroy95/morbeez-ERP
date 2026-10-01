import { HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { RedisService } from '../../infra/redis/redis.service';

// Security Audit SA-02 (brute force), SA-04 (refresh reuse), SA-13 (timing).
describe('AuthService', () => {
  const user = { id: 'u1', tenantId: 't1', email: 'owner@x.test', passwordHash: 'real-hash', status: 'active' };
  let users: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let password: Record<string, jest.Mock>;
  let tokens: Record<string, jest.Mock>;
  let limiter: RateLimiterService;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findByEmailForLogin: jest.fn().mockResolvedValue(user),
      findByPhoneForLogin: jest.fn().mockResolvedValue({ ...user, phone: '+919822011111' }),
      findById: jest.fn().mockResolvedValue(user),
      findRolesAndPermissions: jest.fn().mockResolvedValue({ roles: ['Owner'], permissions: [] }),
    };
    sessions = {
      create: jest.fn().mockResolvedValue({}),
      findByRefreshTokenHash: jest.fn(),
      rotate: jest.fn(),
      deviceOf: jest.fn().mockResolvedValue('device-1'),
      familyIsLive: jest.fn().mockResolvedValue(true),
      revokeFamily: jest.fn(),
    };
    password = { hash: jest.fn().mockResolvedValue('dummy-hash'), verify: jest.fn().mockResolvedValue(true) };
    tokens = {
      signAccessToken: jest.fn().mockReturnValue('access'),
      generateRefreshToken: jest.fn().mockReturnValue({ raw: 'new-raw', hash: 'new-hash', expiresAt: new Date(Date.now() + 1e9) }),
      hashRefreshToken: jest.fn().mockReturnValue('old-hash'),
    };
    limiter = new RateLimiterService({ getClient: () => ({ status: 'end' }) } as unknown as RedisService);
    const config = { get: () => 60 };
    service = new AuthService(users as never, sessions as never, password as never, tokens as never, limiter, config as never);
  });

  describe('login', () => {
    it('signs in with a mobile number however it is typed, looked up in one form', async () => {
      await expect(service.login('098220-11111', 'right', undefined, '1.1.1.1')).resolves.toMatchObject({ accessToken: 'access' });
      expect(users.findByPhoneForLogin).toHaveBeenCalledWith('+919822011111');
      expect(users.findByEmailForLogin).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).toHaveBeenCalledWith(expect.objectContaining({ login: '+919822011111' }));
    });

    it('something that is neither a mobile number nor an email is the same 401, after the same hash', async () => {
      await expect(service.login('12345', 'guess', undefined, '1.1.1.1')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.findByPhoneForLogin).not.toHaveBeenCalled();
      expect(password.verify).toHaveBeenCalledWith('dummy-hash', 'guess');
    });

    it('failures count against the number, not how it was typed', async () => {
      password.verify.mockResolvedValue(false);
      for (let i = 0; i < 10; i++) {
        const typed = i % 2 ? '98220 11111' : '+91 9822011111';
        await service.login(typed, 'wrong', undefined, '1.1.1.1').catch(() => undefined);
      }
      password.verify.mockResolvedValue(true);
      const err = await service.login('9822011111', 'right', undefined, '1.1.1.1').catch((e) => e);
      expect((err as HttpException).getStatus()).toBe(429);
    });

    it('an unknown email still runs a password hash, so it takes as long as a known one', async () => {
      users.findByEmailForLogin.mockResolvedValue(null);
      await expect(service.login('nobody@x.test', 'guess', undefined, '1.1.1.1')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(password.verify).toHaveBeenCalledWith('dummy-hash', 'guess');
    });

    it('locks an account from an address after 10 failures, with a 429 — even for the right password', async () => {
      password.verify.mockResolvedValue(false);
      for (let i = 0; i < 10; i++) await expect(service.login('owner@x.test', `wrong${i}`, undefined, '1.1.1.1')).rejects.toBeInstanceOf(UnauthorizedException);
      password.verify.mockResolvedValue(true);
      const err = await service.login('owner@x.test', 'right', undefined, '1.1.1.1').catch((e) => e);
      expect((err as HttpException).getStatus()).toBe(429);
    });

    it('the real owner elsewhere is not locked out by someone failing from another address', async () => {
      password.verify.mockResolvedValue(false);
      for (let i = 0; i < 10; i++) await service.login('OWNER@x.test', 'wrong', undefined, '6.6.6.6').catch(() => undefined);
      password.verify.mockResolvedValue(true);
      await expect(service.login('owner@x.test', 'right', undefined, '1.1.1.1')).resolves.toMatchObject({ accessToken: 'access' });
    });

    it('records the device the session belongs to', async () => {
      await service.login('owner@x.test', 'right', 'agent', '1.1.1.1', 'device-9');
      expect(sessions.create).toHaveBeenCalledWith('t1', 'u1', 'new-hash', 'agent', expect.any(Date), { deviceId: 'device-9' });
    });
  });

  describe('refresh', () => {
    const live = { id: 's1', tenantId: 't1', userId: 'u1', expiresAt: new Date(Date.now() + 1e9), revokedAt: null, familyId: 'f1', rotatedAt: null };

    it('rotates once and keeps the new session in the same family and on the same device', async () => {
      sessions.findByRefreshTokenHash.mockResolvedValue(live);
      sessions.rotate.mockResolvedValue({ deviceId: 'device-1' });
      await expect(service.refresh('old-raw')).resolves.toMatchObject({ refreshToken: 'new-raw' });
      // Successor written in the same transaction as the rotation — nothing to race.
      expect(sessions.rotate).toHaveBeenCalledWith('t1', 's1', { userId: 'u1', refreshTokenHash: 'new-hash', deviceInfo: undefined, expiresAt: expect.any(Date) });
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('the loser of a race a moment later still gets a token (the client’s own parallel requests)', async () => {
      sessions.findByRefreshTokenHash
        .mockResolvedValueOnce(live)
        .mockResolvedValueOnce({ ...live, revokedAt: new Date(), rotatedAt: new Date(Date.now() - 2000) });
      sessions.rotate.mockResolvedValue(null);
      await expect(service.refresh('old-raw')).resolves.toMatchObject({ refreshToken: 'new-raw' });
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
      expect(sessions.create).toHaveBeenCalledWith('t1', 'u1', 'new-hash', undefined, expect.any(Date), { familyId: 'f1', deviceId: 'device-1' });
    });

    it('a rotated token presented again later revokes the whole family', async () => {
      const replayed = { ...live, revokedAt: new Date(Date.now() - 60_000), rotatedAt: new Date(Date.now() - 60_000) };
      sessions.findByRefreshTokenHash.mockResolvedValue(replayed);
      await expect(service.refresh('old-raw')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.revokeFamily).toHaveBeenCalledWith('t1', 'f1');
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('within the grace window, but the family was already cut off: refused, and nothing else revoked', async () => {
      sessions.findByRefreshTokenHash.mockResolvedValue({ ...live, revokedAt: new Date(), rotatedAt: new Date() });
      sessions.familyIsLive.mockResolvedValue(false);
      await expect(service.refresh('old-raw')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('a token revoked by logout is simply refused', async () => {
      sessions.findByRefreshTokenHash.mockResolvedValue({ ...live, revokedAt: new Date(), rotatedAt: null });
      await expect(service.refresh('old-raw')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
    });
  });
});
