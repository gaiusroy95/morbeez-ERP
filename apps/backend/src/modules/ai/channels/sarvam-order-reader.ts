import { Injectable } from '@nestjs/common';
import { ChannelsConfig } from './channels.config';
import { checkReading, OrderReading, ReadableProduct, READING_SCHEMA, readerInstructions } from './order-reader';

export class ReaderFailed extends Error {}

interface ChatCompletion {
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  error?: { message?: string; code?: string };
}

/**
 * Sarvam AI reads the order out of a customer's message — Malayalam,
 * Kannada, Tamil or English, any script, the way people write to a shop
 * ("thakkali", "ulli", "savala") — as structured output against
 * READING_SCHEMA (Sarvam's chat completions; the client's choice). Then
 * checkReading keeps only what the business sells. Sarvam decides nothing:
 * what it read is a suggestion the owner checks against the message before
 * placing it (DR.3).
 */
@Injectable()
export class SarvamOrderReader {
  constructor(private readonly config: ChannelsConfig) {}

  get available(): boolean {
    return !!this.config.sarvam.apiKey;
  }

  get model(): string {
    return this.config.sarvam.model;
  }

  async read(message: string, businessName: string, products: ReadableProduct[]): Promise<OrderReading> {
    const s = this.config.sarvam;
    if (!s.apiKey) throw new ReaderFailed('SARVAM_API_KEY is not set');
    let res: Response;
    try {
      res = await fetch(`${s.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-subscription-key': s.apiKey, Authorization: `Bearer ${s.apiKey}` },
        body: JSON.stringify({
          model: s.model,
          messages: [
            { role: 'system', content: readerInstructions(businessName, products) },
            { role: 'user', content: `The customer's message:\n<message>\n${message}\n</message>` },
          ],
          temperature: 0.1,
          max_tokens: 2000,
          reasoning_effort: 'low',
          response_format: { type: 'json_schema', json_schema: { name: 'order_reading', schema: READING_SCHEMA, strict: true } },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new ReaderFailed(`Sarvam couldn't be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json().catch(() => ({}))) as ChatCompletion;
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new ReaderFailed('the Sarvam API key was refused');
      if (res.status === 429) throw new ReaderFailed('Sarvam is rate-limiting this key, or its credit ran out');
      throw new ReaderFailed(`Sarvam answered ${res.status}${body.error?.message ? `: ${body.error.message}` : ''}`);
    }
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'length') throw new ReaderFailed('the reading was cut off');
    if (choice?.finish_reason === 'content_filter') throw new ReaderFailed('Sarvam declined to read it');
    const text = choice?.message?.content;
    if (!text) throw new ReaderFailed('Sarvam returned no reading');
    try {
      return checkReading(JSON.parse(text), products);
    } catch {
      throw new ReaderFailed('the reading was not in the expected form');
    }
  }
}
