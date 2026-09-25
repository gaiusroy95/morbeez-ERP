import { Test } from '@nestjs/testing';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [OrdersService],
    }).compile();

    service = module.get(OrdersService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
