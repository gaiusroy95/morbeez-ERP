import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ChannelsConfig } from './channels.config';
import { WhatsAppService } from './whatsapp.service';
import { VoiceService } from './voice.service';

/** Twilio posts form fields; each value is a string. */
function formOf(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
}

// The providers' callbacks: no session, no tenant in the request. Each is
// checked against the provider's signature before anything is read or
// written — Meta's with the app secret, Twilio's with the auth token over
// the exact public URL it called — and finds its business through a
// SECURITY DEFINER lookup (the WhatsApp number, the call's own id).
@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly config: ChannelsConfig,
    private readonly whatsapp: WhatsAppService,
    private readonly voice: VoiceService,
  ) {}

  private publicUrl(req: Request): string {
    return `${this.config.publicApiUrl ?? ''}${req.originalUrl}`;
  }

  @Get('whatsapp')
  verifyWhatsApp(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    res.status(200).type('text/plain').send(this.whatsapp.verify(mode, token, challenge));
  }

  @Post('whatsapp')
  @HttpCode(200)
  receiveWhatsApp(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string | undefined) {
    return this.whatsapp.receive(req.rawBody, signature, req.body);
  }

  @Post('twilio/voice/:id')
  async callAnswered(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Headers('x-twilio-signature') signature: string | undefined, @Res() res: Response) {
    res.status(200).type('text/xml').send(await this.voice.twiml(id, this.publicUrl(req), formOf(req), signature));
  }

  @Post('twilio/voice/:id/keypress')
  async keyPressed(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Headers('x-twilio-signature') signature: string | undefined, @Res() res: Response) {
    res.status(200).type('text/xml').send(await this.voice.keypress(id, this.publicUrl(req), formOf(req), signature));
  }

  @Post('twilio/voice/:id/status')
  @HttpCode(204)
  async callStatus(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Headers('x-twilio-signature') signature: string | undefined): Promise<void> {
    await this.voice.status(id, this.publicUrl(req), formOf(req), signature);
  }
}
