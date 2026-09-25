import { Test } from '@nestjs/testing';
import { FinanceService } from './finance.service';

describe('FinanceService', () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [FinanceService],
    }).compile();

    service = module.get(FinanceService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
