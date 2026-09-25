import { Test } from '@nestjs/testing';
import { TenantService } from './tenant.service';

describe('TenantService', () => {
  let service: TenantService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [TenantService],
    }).compile();

    service = module.get(TenantService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
