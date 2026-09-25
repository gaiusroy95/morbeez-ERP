import { Controller } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
