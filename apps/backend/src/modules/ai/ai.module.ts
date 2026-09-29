import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRepository } from './repositories/ai.repository';
import { AiDataRepository } from './repositories/ai-data.repository';

// Bounded context: AI Recommendations (Constitution I.3, Article VIII; AI
// System design). Imports no other module and calls none: it reads the
// business through a read-only role (DR.1) and writes only its own ai
// schema. Nothing the business runs on can be changed from here.
@Module({
  controllers: [AiController],
  providers: [AiService, AiRepository, AiDataRepository],
})
export class AiModule {}
