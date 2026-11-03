import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRepository } from './repositories/ai.repository';
import { AiDataRepository } from './repositories/ai-data.repository';
import { ChannelsConfig } from './channels/channels.config';
import { ChannelsRepository } from './channels/channels.repository';
import { SarvamOrderReader } from './channels/sarvam-order-reader';
import { WhatsAppService } from './channels/whatsapp.service';
import { VoiceService } from './channels/voice.service';
import { IntegrationsService } from './channels/integrations.service';
import { ChannelsController } from './channels/channels.controller';
import { WebhooksController } from './channels/webhooks.controller';

// Bounded context: AI Recommendations (Constitution I.3, Article VIII; AI
// System design). Imports no other module and calls none: it reads the
// business through a read-only role (DR.1) and writes only its own ai
// schema. Nothing the business runs on can be changed from here.
//
// Its channels to customers (channels/) keep to the same rule: a WhatsApp
// order becomes a suggestion, an automated call records the key pressed;
// placing the order or taking the payment stays the owner's.
@Module({
  controllers: [AiController, ChannelsController, WebhooksController],
  providers: [AiService, AiRepository, AiDataRepository, ChannelsConfig, ChannelsRepository, SarvamOrderReader, WhatsAppService, VoiceService, IntegrationsService],
})
export class AiModule {}
