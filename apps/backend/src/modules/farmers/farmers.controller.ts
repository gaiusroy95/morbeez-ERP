import { Controller } from '@nestjs/common';
import { FarmersService } from './farmers.service';

@Controller('farmers')
export class FarmersController {
  constructor(private readonly farmersService: FarmersService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
