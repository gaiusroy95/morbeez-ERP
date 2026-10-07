import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../infra/database/database.service';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { normalizeIndianMobile } from '../../common/phone';
import { AlertsRepository } from '../alerts/alerts.repository';
import { AuthService, TokenPair } from './auth.service';
import { UsersRepository } from './repositories/users.repository';
import { PasswordService } from './security/password.service';

/** Wrong PINs before the PIN stops working on that phone and the password is needed again. */
export const PIN_ATTEMPTS = 5;
const PIN_FORMAT = /^\d{4,6}$/;
const PIN_IP_LIMIT = { max: 30, windowSeconds: 15 * 60 };

interface DevicePinRow {
  id: string;
  pin_hash: string;
  failed_attempts: number;
}

/**
 * Driver PIN sign-in on the driver's own registered phone (client Q&A,
 * pilot scope: "PIN on the driver's own registered phone"). After signing
 * in with their password once, a driver sets a 4–6 digit PIN for that
 * phone; from then on the PIN signs them in there — and only there: the
 * PIN is bound to the phone's install id, so knowing it is useless on any
 * other phone. Five wrong PINs and it's gone (the password works as
 * before), and the owner is told.
 */
@Injectable()
export class PinAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly password: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly auth: AuthService,
    private readonly alerts: AlertsRepository,
  ) {}

  private dummyHash?: Promise<string>;

  async setPin(tenantId: string, userId: string, deviceId: string, pin: string): Promise<{ deviceId: string }> {
    if (!PIN_FORMAT.test(pin)) throw new BadRequestException('A PIN is 4 to 6 digits');
    if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
      throw new BadRequestException('Pick a PIN that is harder to guess than repeated or consecutive digits');
    }
    const hash = await this.password.hash(pin);
    await this.db.withTenant(tenantId, (client) =>
      client.query(
        `INSERT INTO identity.device_pin (tenant_id, user_id, device_id, pin_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, device_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, created_at = now()`,
        [tenantId, userId, deviceId, hash],
      ),
    );
    return { deviceId };
  }

  async removePin(tenantId: string, userId: string, deviceId: string): Promise<void> {
    await this.db.withTenant(tenantId, (client) =>
      client.query('DELETE FROM identity.device_pin WHERE user_id = $1 AND device_id = $2', [userId, deviceId]),
    );
  }

  async pinLogin(login: string, deviceId: string, pin: string, deviceInfo?: string, ip?: string): Promise<TokenPair> {
    if (ip) await this.limiter.consume(`pin-ip:${ip}`, PIN_IP_LIMIT, 'Too many sign-in attempts from this network.');
    const phone = normalizeIndianMobile(login.trim());
    const user = phone ? await this.users.findByPhoneForLogin(phone) : null;
    // One answer for every failure, so the PIN screen tells nobody which part was wrong.
    const refused = new UnauthorizedException('Wrong PIN, or no PIN on this phone — sign in with your password');
    if (!user || user.status !== 'active') {
      await this.password.verify(await (this.dummyHash ??= this.password.hash('no-pin-here')), pin); // same cost either way
      throw refused;
    }

    const outcome = await this.db.withTenant(user.tenantId, async (client) => {
      const row = (
        await client.query<DevicePinRow>(
          'SELECT id, pin_hash, failed_attempts FROM identity.device_pin WHERE user_id = $1 AND device_id = $2 FOR UPDATE',
          [user.id, deviceId],
        )
      ).rows[0];
      if (!row) return 'no_pin' as const;
      if (await this.password.verify(row.pin_hash, pin)) {
        await client.query('UPDATE identity.device_pin SET failed_attempts = 0, last_used_at = now() WHERE id = $1', [row.id]);
        return 'ok' as const;
      }
      const attempts = row.failed_attempts + 1;
      if (attempts >= PIN_ATTEMPTS) {
        await client.query('DELETE FROM identity.device_pin WHERE id = $1', [row.id]);
        await this.lockedAlertWithClient(client, user.tenantId, user.id, row.id);
        return 'locked' as const;
      }
      await client.query('UPDATE identity.device_pin SET failed_attempts = $2 WHERE id = $1', [row.id, attempts]);
      return 'wrong' as const;
    });

    if (outcome === 'locked') {
      throw new UnauthorizedException(`${PIN_ATTEMPTS} wrong PINs — the PIN is switched off on this phone. Sign in with your password.`);
    }
    if (outcome !== 'ok') throw refused;
    return this.auth.issueFor(user, deviceInfo, deviceId);
  }

  /** Someone kept guessing a driver's PIN: a security exception for the owner (client Q&A, E: Q19). */
  private async lockedAlertWithClient(client: PoolClient, tenantId: string, userId: string, pinId: string): Promise<void> {
    const who = (
      await client.query<{ name: string | null; phone: string | null }>(
        `SELECT e.name, u.phone FROM identity.app_user u LEFT JOIN trading_partners.employee e ON e.user_id = u.id WHERE u.id = $1`,
        [userId],
      )
    ).rows[0];
    const name = who?.name ?? who?.phone ?? 'A user';
    await this.alerts.raiseWithClient(client, tenantId, {
      kind: 'security',
      severity: 'critical',
      title: `PIN locked — ${name}`,
      detail: `${PIN_ATTEMPTS} wrong PINs were entered on ${name}'s phone, so the PIN is switched off there. If it wasn't them, change their password.`,
      dedupeKey: `pin-locked:${pinId}`,
    });
  }
}
