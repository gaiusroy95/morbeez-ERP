import { Test } from '@nestjs/testing';
import { VehiclesService } from './vehicles.service';

describe('VehiclesService', () => {
  let service: VehiclesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [VehiclesService],
    }).compile();

    service = module.get(VehiclesService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
