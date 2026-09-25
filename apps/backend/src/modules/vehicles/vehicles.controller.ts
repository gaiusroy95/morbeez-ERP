import { Controller } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  // Routes defined per the API contract (OpenAPI spec, Constitution IV.1).
}
