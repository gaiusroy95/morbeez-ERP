import { Test } from '@nestjs/testing';
import { ProcurementService } from './procurement.service';

describe('ProcurementService', () => {
  let service: ProcurementService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ProcurementService],
    }).compile();

    service = module.get(ProcurementService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
