import { Test } from '@nestjs/testing';
import { LogisticsService } from './logistics.service';

describe('LogisticsService', () => {
  let service: LogisticsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [LogisticsService],
    }).compile();

    service = module.get(LogisticsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
