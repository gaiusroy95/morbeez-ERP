import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ChannelsConfig } from './channels.config';
import { checkReading, OrderReading, ReadableProduct, READING_SCHEMA, readerInstructions } from './order-reader';

export class ReaderFailed extends Error {}

/**
 * Claude reads the order out of a customer's message (any of the four
 * languages, any script, spelt any way), as structured output against
 * READING_SCHEMA; checkReading then keeps only what the business sells. The
 * model never decides anything: what it read becomes a suggestion the owner
 * checks against the message before placing it (DR.3).
 *
 * Low effort: reading a short message is quick work. With the server-side
 * fallback on, a request one model declines is retried by another inside
 * the same call.
 */
@Injectable()
export class ClaudeOrderReader {
  private client: Anthropic | null = null;

  constructor(private readonly config: ChannelsConfig) {}

  get available(): boolean {
    return !!this.config.anthropic.apiKey;
  }

  get model(): string {
    return this.config.anthropic.model;
  }

  private anthropic(): Anthropic {
    const a = this.config.anthropic;
    if (!a.apiKey) throw new ReaderFailed('ANTHROPIC_API_KEY is not set');
    this.client ??= new Anthropic({ apiKey: a.apiKey, ...(a.baseUrl && { baseURL: a.baseUrl }), timeout: 60_000, maxRetries: 2 });
    return this.client;
  }

  async read(message: string, businessName: string, products: ReadableProduct[]): Promise<OrderReading> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.anthropic().beta.messages.create({
        model: this.model,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: readerInstructions(businessName, products),
        output_config: { effort: 'low', format: { type: 'json_schema', schema: READING_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{ role: 'user', content: `The customer's message:\n<message>\n${message}\n</message>` }],
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new ReaderFailed('the Anthropic API key was refused');
      if (err instanceof Anthropic.RateLimitError) throw new ReaderFailed('Anthropic is rate-limiting this key');
      if (err instanceof Anthropic.APIError) throw new ReaderFailed(`Anthropic answered ${err.status ?? 'with an error'}`);
      throw new ReaderFailed(err instanceof Error ? err.message : String(err));
    }
    if (response.stop_reason === 'refusal') throw new ReaderFailed('the model declined to read it');
    if (response.stop_reason === 'max_tokens') throw new ReaderFailed('the reading was cut off');
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text;
    if (!text) throw new ReaderFailed('the model returned no reading');
    try {
      return checkReading(JSON.parse(text), products);
    } catch {
      throw new ReaderFailed('the reading was not in the expected form');
    }
  }
}
