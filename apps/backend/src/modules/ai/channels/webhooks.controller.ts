import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { WhatsAppService } from './whatsapp.service';
import { VoiceService } from './voice.service';

// The providers' callbacks: no session, no tenant in the request. Meta's are
// checked against its signature with the app secret before anything is read
// or written; Sarvam's (unsigned) carry a token made for each call. Each
// finds its business through a SECURITY DEFINER lookup (the WhatsApp number,
// the call's own id).
@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly voice: VoiceService,
  ) {}

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

  /** Sarvam Voice Agents: the call ended — what came of it. */
  @Post('sarvam/calls/:id')
  @HttpCode(200)
  callFinished(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string | undefined, @Body() payload: Record<string, unknown>) {
    return this.voice.finished(id, token, payload);
  }
}
