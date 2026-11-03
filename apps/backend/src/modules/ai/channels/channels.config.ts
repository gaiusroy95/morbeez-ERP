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

  /** Where Meta and Sarvam reach this API: https://api.example.com, no trailing slash. */
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

  /** Sarvam's language model: reads the order out of a WhatsApp message. */
  get sarvam() {
    return {
      apiKey: this.get('SARVAM_API_KEY'),
      model: this.get('SARVAM_MODEL') ?? 'sarvam-105b',
      apiBase: this.get('SARVAM_API_BASE') ?? 'https://api.sarvam.ai',
    };
  }

  /** Sarvam Voice Agents: the agent that holds the conversation on a call. */
  get sarvamVoice() {
    return {
      apiKey: this.get('SARVAM_VOICE_API_KEY'),
      orgId: this.get('SARVAM_ORG_ID'),
      workspaceId: this.get('SARVAM_WORKSPACE_ID'),
      appId: this.get('SARVAM_VOICE_APP_ID'),
      appVersion: Number(this.get('SARVAM_VOICE_APP_VERSION') ?? '1'),
      connectionId: this.get('SARVAM_VOICE_CONNECTION_ID'),
      fromNumber: this.get('SARVAM_VOICE_FROM_NUMBER'),
      apiBase: this.get('SARVAM_VOICE_API_BASE') ?? 'https://apps.sarvam.ai',
    };
  }

  /** Calls can be placed, and Sarvam can report back what came of them. */
  get callsReady(): boolean {
    const v = this.sarvamVoice;
    return !!(v.apiKey && v.orgId && v.workspaceId && v.appId && v.connectionId && v.fromNumber && this.publicApiUrl);
  }
}
