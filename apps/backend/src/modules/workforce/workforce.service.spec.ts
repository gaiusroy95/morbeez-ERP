import { Test } from '@nestjs/testing';
import { WorkforceService } from './workforce.service';

describe('WorkforceService', () => {
  let service: WorkforceService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [WorkforceService],
    }).compile();

    service = module.get(WorkforceService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
