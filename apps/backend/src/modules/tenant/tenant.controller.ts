import { Controller } from '@nestjs/common';
import { TenantService } from './tenant.service';

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
