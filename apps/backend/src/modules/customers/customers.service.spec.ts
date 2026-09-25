import { Test } from '@nestjs/testing';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CustomersService],
    }).compile();

    service = module.get(CustomersService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
