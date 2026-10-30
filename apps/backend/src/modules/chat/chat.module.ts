import { Module } from '@nestjs/common';
import { WorkforceModule } from '../workforce/workforce.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRepository } from './chat.repository';

// Bounded context: Chat (driver app V1, D9) — one conversation per driver
// with the business, messages about their trips, photos, what's unread.
// Owns the chat schema; reads trips and workers to check what a message is
// about and who wrote it.
@Module({
  imports: [WorkforceModule],
  controllers: [ChatController],
  providers: [ChatService, ChatRepository],
})
export class ChatModule {}
