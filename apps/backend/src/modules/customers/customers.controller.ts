import { Controller } from '@nestjs/common';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
