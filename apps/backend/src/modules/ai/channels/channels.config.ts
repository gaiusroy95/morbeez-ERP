import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../../config/env.validation';

const trimmed = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * The outside services the AI talks to, as this deployment is set up
 * (apps/backend/.env.example lists where each key comes from). Each is
 * optional: unset, that channel is off and says so on Settings →
 * Integrations — nothing else breaks.
 */
@Injectable()
export class ChannelsConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get(key: keyof Env): string | null {
    return trimmed(this.config.get(key, { infer: true }) as string | undefined);
  }

  /** Where Meta and Twilio reach this API: https://api.example.com, no trailing slash. */
  get publicApiUrl(): string | null {
    return this.get('PUBLIC_API_URL')?.replace(/\/+$/, '') ?? null;
  }

  get whatsapp() {
    return {
      verifyToken: this.get('WHATSAPP_VERIFY_TOKEN'),
      appSecret: this.get('WHATSAPP_APP_SECRET'),
      accessToken: this.get('WHATSAPP_ACCESS_TOKEN'),
      apiVersion: this.get('WHATSAPP_API_VERSION') ?? 'v23.0',
      apiBase: this.get('WHATSAPP_API_BASE') ?? 'https://graph.facebook.com',
    };
  }

  /** Messages can come in: Meta can verify the webhook and sign what it sends. */
  get whatsappReceives(): boolean {
    const w = this.whatsapp;
    return !!(w.verifyToken && w.appSecret);
  }

  /** The business can answer on WhatsApp. */
  get whatsappReplies(): boolean {
    return this.whatsappReceives && !!this.whatsapp.accessToken;
  }

  get anthropic() {
    return {
      apiKey: this.get('ANTHROPIC_API_KEY'),
      model: this.get('ANTHROPIC_MODEL') ?? 'claude-opus-5-5',
      baseUrl: this.get('ANTHROPIC_BASE_URL'),
    };
  }

  get twilio() {
    return {
      accountSid: this.get('TWILIO_ACCOUNT_SID'),
      authToken: this.get('TWILIO_AUTH_TOKEN'),
      fromNumber: this.get('TWILIO_FROM_NUMBER'),
      apiBase: this.get('TWILIO_API_BASE') ?? 'https://api.twilio.com',
    };
  }

  /** Calls can be placed and Twilio can reach back for what to say. */
  get callsReady(): boolean {
    const t = this.twilio;
    return !!(t.accountSid && t.authToken && t.fromNumber && this.publicApiUrl);
  }
}
