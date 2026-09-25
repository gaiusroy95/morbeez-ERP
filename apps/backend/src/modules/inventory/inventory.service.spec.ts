import { Test } from '@nestjs/testing';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [InventoryService],
    }).compile();

    service = module.get(InventoryService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
