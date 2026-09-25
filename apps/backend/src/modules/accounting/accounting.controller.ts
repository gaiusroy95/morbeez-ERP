import { Controller } from '@nestjs/common';
import { AccountingService } from './accounting.service';

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
