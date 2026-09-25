import { Controller } from '@nestjs/common';
import { LogisticsService } from './logistics.service';

@Controller('logistics')
export class LogisticsController {
  constructor(private readonly logisticsService: LogisticsService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
