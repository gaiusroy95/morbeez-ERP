import { Test } from '@nestjs/testing';
import { AccountingService } from './accounting.service';

describe('AccountingService', () => {
  let service: AccountingService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AccountingService],
    }).compile();

    service = module.get(AccountingService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
