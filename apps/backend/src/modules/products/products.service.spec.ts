import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ProductsService } from './products.service';
import { ProductsRepository } from './repositories/products.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ProductRecord } from './entities/product.entity';

const mockProduct: ProductRecord = {
  id: 'product-1',
  tenantId: 'tenant-1',
  name: 'Tomato',
  category: 'Vegetables',
  baseUom: 'kg',
  basePrice: '25.00',
  kind: 'standard',
  packSize: null,
  lossTolerancePct: null,
  unitWeightKg: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const fakeClient = {} as PoolClient;

describe('ProductsService', () => {
  let service: ProductsService;
  let repo: jest.Mocked<ProductsRepository>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: ProductsRepository,
          useValue: {
            list: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            updateWithClient: jest.fn(),
            setStatusWithClient: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProductsService);
    repo = module.get(ProductsRepository);
    audit = module.get(AuditService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('create() persists the entity and audits it in the same transaction', async () => {
    repo.createWithClient.mockResolvedValue(mockProduct);

    await service.create('tenant-1', 'user-1', {
      name: 'Tomato',
      baseUom: 'kg',
      basePrice: 25,
    });

    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ action: 'create', entityType: 'product', entityId: 'product-1' }),
    );
  });

  it('getById() throws NotFound for an unknown product rather than returning undefined', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(service.getById('tenant-1', 'nonexistent')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update() propagates OptimisticLockException from the repository unchanged', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockProduct);
    const conflict = new Error('version mismatch');
    repo.updateWithClient.mockRejectedValue(conflict);

    await expect(
      service.update('tenant-1', 'user-1', 'product-1', { version: 1, basePrice: 30 }),
    ).rejects.toThrow(conflict);
    // And critically: no audit entry for a change that never actually happened.
    expect(audit.record).not.toHaveBeenCalled();
  });

  describe('weight per unit (P5 rule C4: KG-equivalent for allocation)', () => {
    it('is kept for a product counted in units', async () => {
      repo.createWithClient.mockResolvedValue({ ...mockProduct, baseUom: 'piece', kind: 'egg', unitWeightKg: '0.0600' });
      await service.create('tenant-1', 'user-1', { name: 'Eggs', baseUom: 'unit', kind: 'egg', unitWeightKg: 0.06 });
      expect(repo.createWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', expect.objectContaining({ baseUom: 'piece', unitWeightKg: 0.06 }));
    });

    it('is refused for a product sold by weight, on create and on update', async () => {
      await expect(service.create('tenant-1', 'user-1', { name: 'Onion', baseUom: 'kg', unitWeightKg: 1 })).rejects.toThrow(/needs no weight per unit/);
      await expect(service.create('tenant-1', 'user-1', { name: 'Chilli', baseUom: 'g', unitWeightKg: 0.5 })).rejects.toThrow(/needs no weight per unit/);
      repo.findByIdWithClient.mockResolvedValue(mockProduct);
      await expect(service.update('tenant-1', 'user-1', 'product-1', { version: 1, unitWeightKg: 1 })).rejects.toThrow(/needs no weight per unit/);
      expect(repo.createWithClient).not.toHaveBeenCalled();
      expect(repo.updateWithClient).not.toHaveBeenCalled();
    });

    it('may be cleared on a product sold by weight, and set when it moves to units', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockProduct);
      repo.updateWithClient.mockResolvedValue({ ...mockProduct, baseUom: 'bag', unitWeightKg: '25.0000' });
      await service.update('tenant-1', 'user-1', 'product-1', { version: 1, unitWeightKg: null });
      await service.update('tenant-1', 'user-1', 'product-1', { version: 1, baseUom: 'bag', unitWeightKg: 25 });
      expect(repo.updateWithClient).toHaveBeenLastCalledWith(fakeClient, 'product-1', 1, expect.objectContaining({ baseUom: 'bag', unitWeightKg: 25 }));
    });
  });
});
