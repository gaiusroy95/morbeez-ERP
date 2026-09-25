import { Controller } from '@nestjs/common';
import { WorkforceService } from './workforce.service';

@Controller('workforce')
export class WorkforceController {
  constructor(private readonly workforceService: WorkforceService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
