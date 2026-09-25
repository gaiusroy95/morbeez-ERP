import { Test } from '@nestjs/testing';
import { FarmersService } from './farmers.service';

describe('FarmersService', () => {
  let service: FarmersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [FarmersService],
    }).compile();

    service = module.get(FarmersService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
