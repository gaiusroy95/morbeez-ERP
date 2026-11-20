import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CustomersService, isImage, locationOf } from './customers.service';
import { CustomersRepository } from './repositories/customers.repository';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CustomerRecord } from './entities/customer.entity';
import { RoutesService } from '../routes/routes.service';
import { CustomerInsightsRepository } from './repositories/customer-insights.repository';
import { ObjectStorageService } from '../../infra/storage/object-storage.service';

const mockCustomer: CustomerRecord = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Test Restaurant',
  contact: {},
  place: null,
  address: null,
  landmark: null,
  shopPhoto: null,
  routeId: null,
  preferredLanguage: 'en',
  creditLimit: '0.00',
  paymentTermsDays: 0,
  financeChargeRateMonthly: '0.00',
  financeChargeRateAnnual: '0.00',
  financeChargeGraceDays: 0,
  creditHold: false,
  creditHoldReason: null,
  financeChargeEnabled: false,
  billToBill: false,
  isWalkIn: false,
  doNotCall: false,
  qrToken: 'QR0000000000TEST',
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

// Records the SQL the map-pin helpers send; the repository is mocked.
const fakeClient = { query: jest.fn() } as unknown as PoolClient & { query: jest.Mock };

describe('CustomersService', () => {
  let service: CustomersService;
  let repo: jest.Mocked<CustomersRepository>;
  let db: jest.Mocked<DatabaseService>;
  let audit: jest.Mocked<AuditService>;
  let storage: { put: jest.Mock; get: jest.Mock };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: CustomersRepository,
          useValue: {
            list: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            updateWithClient: jest.fn(),
            setStatusWithClient: jest.fn(),
            updateCreditTermsWithClient: jest.fn(),
            recordTermsVersionWithClient: jest.fn(),
            holdForReviewWithClient: jest.fn(),
            setShopPhotoWithClient: jest.fn(),
            shopPhotoWithClient: jest.fn(),
          },
        },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: RoutesService, useValue: { assertUsable: jest.fn(), placeWithClient: jest.fn() } },
        { provide: CustomerInsightsRepository, useValue: { figuresWithClient: jest.fn().mockResolvedValue([]) } },
        { provide: ObjectStorageService, useValue: { put: jest.fn(), get: jest.fn() } },
      ],
    }).compile();

    service = module.get(CustomersService);
    repo = module.get(CustomersRepository);
    db = module.get(DatabaseService);
    audit = module.get(AuditService);
    storage = module.get(ObjectStorageService);
    fakeClient.query.mockReset().mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('create() writes the entity and an audit "create" entry in the same transaction', async () => {
    repo.createWithClient.mockResolvedValue(mockCustomer);

    await service.create('tenant-1', 'user-1', { name: 'Test Restaurant' });

    expect(db.withTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    // F6: the terms it starts with are its first dated version.
    expect(repo.recordTermsVersionWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'created', 'user-1');
    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        action: 'create',
        entityType: 'customer',
        entityId: mockCustomer.id,
      }),
    );
  });

  describe('credit terms (Master Spec v3 P6, F5, F6, F8)', () => {
    it('every change is a new dated version, never an overwrite', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockCustomer);
      repo.updateCreditTermsWithClient.mockResolvedValue({ ...mockCustomer, creditLimit: '90000.00', version: 2 });
      await service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, creditLimit: 90000 });
      expect(repo.recordTermsVersionWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'terms', 'user-1');
    });

    it('the finance charge is switched on only with a rate', async () => {
      repo.findByIdWithClient.mockResolvedValue({ ...mockCustomer, financeChargeRateAnnual: '0.00' });
      await expect(service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, financeChargeEnabled: true })).rejects.toBeInstanceOf(BadRequestException);
      repo.updateCreditTermsWithClient.mockResolvedValue(mockCustomer);
      await service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, financeChargeEnabled: true, financeChargeRateAnnual: 18 });
      expect(repo.updateCreditTermsWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 1, expect.objectContaining({ financeChargeEnabled: true, financeChargeRateAnnual: 18 }));
    });

    it('Bill-to-Bill needs a backstop of at least a day', async () => {
      repo.findByIdWithClient.mockResolvedValue({ ...mockCustomer, paymentTermsDays: 0 });
      await expect(service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, billToBill: true })).rejects.toBeInstanceOf(BadRequestException);
      repo.updateCreditTermsWithClient.mockResolvedValue(mockCustomer);
      await service.updateCreditTerms('tenant-1', 'user-1', mockCustomer.id, { version: 1, billToBill: true, paymentTermsDays: 15 });
      expect(repo.updateCreditTermsWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 1, expect.objectContaining({ billToBill: true, paymentTermsDays: 15 }));
    });

    it('BD.4: a write-off puts the customer on hold, as a version of their terms', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockCustomer);
      repo.holdForReviewWithClient.mockResolvedValue({ ...mockCustomer, creditHold: true, creditHoldReason: 'Bad debt' });
      await service.holdForReviewWithClient(fakeClient as never, 'tenant-1', 'user-1', mockCustomer.id, 'Bad debt');
      expect(repo.holdForReviewWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'Bad debt');
      expect(repo.recordTermsVersionWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'write_off', 'user-1');
    });
  });

  it('update() reads the before-state, applies the change, and audits both', async () => {
    const updated = { ...mockCustomer, name: 'Renamed', version: 2 };
    repo.findByIdWithClient.mockResolvedValue(mockCustomer);
    repo.updateWithClient.mockResolvedValue(updated);

    const result = await service.update('tenant-1', 'user-1', 'customer-1', {
      version: 1,
      name: 'Renamed',
    });

    expect(result).toEqual(updated);
    expect(repo.updateWithClient).toHaveBeenCalledWith(
      fakeClient,
      'customer-1',
      1,
      expect.objectContaining({ name: 'Renamed' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        action: 'update',
        before: mockCustomer,
        after: updated,
      }),
    );
  });

  it('update() throws NotFound before ever touching the optimistic-lock update, for an unknown id', async () => {
    repo.findByIdWithClient.mockResolvedValue(null);

    await expect(
      service.update('tenant-1', 'user-1', 'nonexistent', { version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.updateWithClient).not.toHaveBeenCalled();
  });

  it('archive() and restore() record distinct audit actions, not a generic "update"', async () => {
    repo.findByIdWithClient.mockResolvedValue(mockCustomer);
    repo.setStatusWithClient.mockResolvedValue({ ...mockCustomer, status: 'archived' });

    await service.archive('tenant-1', 'user-1', 'customer-1');

    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ action: 'archive' }),
    );
  });

  // The client (20 Nov 2026): name, contact person, phone, GPS location, landmark, shop front photo.
  describe('customer onboarding', () => {
    const pinSql = () => fakeClient.query.mock.calls.filter(([sql]) => /place_pin/.test(String(sql)));

    it('keeps who to ask for, the landmark and the shop’s GPS position — as its map pin, in the same transaction', async () => {
      repo.createWithClient.mockResolvedValue(mockCustomer);
      await service.create('tenant-1', 'user-1', {
        name: 'Hotel Sagar',
        contact: { person: '  Ravi (manager) ', phone: '98450 12345' },
        landmark: ' Opposite the bus stand ',
        latitude: 12.31081234,
        longitude: 76.6402,
      });
      expect(repo.createWithClient).toHaveBeenCalledWith(
        fakeClient,
        'tenant-1',
        'user-1',
        expect.objectContaining({ contact: { person: 'Ravi (manager)', phone: '98450 12345' }, landmark: 'Opposite the bus stand' }),
      );
      const [update, insert] = pinSql();
      expect(update[0]).toMatch(/UPDATE fulfilment.place_pin/);
      expect(insert[0]).toMatch(/INSERT INTO fulfilment.place_pin/);
      expect(insert[1]).toEqual(['tenant-1', 'customer', mockCustomer.id, '12.310812', '76.640200', 'user-1']);
      expect(audit.record).toHaveBeenCalledWith(
        fakeClient,
        expect.objectContaining({ action: 'create', after: expect.objectContaining({ location: { latitude: 12.31081234, longitude: 76.6402 } }) }),
      );
    });

    it('finance cost on or off from the start — on only with a rate, kept in the first terms version', async () => {
      await expect(service.create('tenant-1', 'user-1', { name: 'Hotel Sagar', financeChargeEnabled: true })).rejects.toThrow(/annual rate/);
      expect(repo.createWithClient).not.toHaveBeenCalled();
      repo.createWithClient.mockResolvedValue(mockCustomer);
      await service.create('tenant-1', 'user-1', { name: 'Hotel Sagar', financeChargeEnabled: true, financeChargeRateAnnual: 18, financeChargeGraceDays: 3 });
      expect(repo.createWithClient).toHaveBeenCalledWith(
        fakeClient,
        'tenant-1',
        'user-1',
        expect.objectContaining({ financeChargeEnabled: true, financeChargeRateAnnual: 18, financeChargeRateMonthly: 1.48, financeChargeGraceDays: 3 }),
      );
      expect(repo.recordTermsVersionWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 'created', 'user-1');
      repo.createWithClient.mockClear();
      await service.create('tenant-1', 'user-1', { name: 'Cash Mess' });
      expect(repo.createWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', expect.objectContaining({ financeChargeEnabled: false, financeChargeRateAnnual: 0 }));
    });

    it('a customer without a location has no pin', async () => {
      repo.createWithClient.mockResolvedValue(mockCustomer);
      await service.create('tenant-1', 'user-1', { name: 'Walk-in Mess' });
      expect(pinSql()).toHaveLength(0);
    });

    it('half a location, or 0, 0 (a phone with no fix), is refused before anything is written', async () => {
      await expect(service.create('tenant-1', 'user-1', { name: 'Hotel Sagar', latitude: 12.31 })).rejects.toThrow(/both the latitude and the longitude/);
      await expect(service.create('tenant-1', 'user-1', { name: 'Hotel Sagar', latitude: 0, longitude: 0 })).rejects.toThrow(/0, 0/);
      await expect(service.update('tenant-1', 'user-1', mockCustomer.id, { version: 1, longitude: 76.64 })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createWithClient).not.toHaveBeenCalled();
      expect(repo.updateWithClient).not.toHaveBeenCalled();
    });

    it('editing moves the pin, both null take it away, and leaving them out keeps it', async () => {
      repo.findByIdWithClient.mockResolvedValue(mockCustomer);
      repo.updateWithClient.mockResolvedValue({ ...mockCustomer, landmark: 'Near the temple', version: 2 });
      await service.update('tenant-1', 'user-1', mockCustomer.id, { version: 1, latitude: 12.3, longitude: 76.6, landmark: 'Near the temple' });
      expect(repo.updateWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 1, expect.objectContaining({ landmark: 'Near the temple' }));
      expect(pinSql().some(([sql]) => /INSERT INTO fulfilment.place_pin/.test(String(sql)))).toBe(true);

      fakeClient.query.mockClear();
      await service.update('tenant-1', 'user-1', mockCustomer.id, { version: 2, latitude: null, longitude: null });
      expect(pinSql().some(([sql]) => /DELETE FROM fulfilment.place_pin/.test(String(sql)))).toBe(true);

      fakeClient.query.mockClear();
      await service.update('tenant-1', 'user-1', mockCustomer.id, { version: 3, name: 'Hotel Sagar Veg' });
      expect(pinSql()).toHaveLength(0);
    });

    it('a blank landmark clears it', async () => {
      repo.findByIdWithClient.mockResolvedValue({ ...mockCustomer, landmark: 'Old' });
      repo.updateWithClient.mockResolvedValue(mockCustomer);
      await service.update('tenant-1', 'user-1', mockCustomer.id, { version: 1, landmark: '   ' });
      expect(repo.updateWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, 1, expect.objectContaining({ landmark: null }));
    });

    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    it('the shop photo: kept under the tenant, recorded on the customer and audited', async () => {
      repo.findById.mockResolvedValue(mockCustomer);
      repo.setShopPhotoWithClient.mockResolvedValue({ ...mockCustomer, shopPhoto: { uploadedAt: new Date('2026-11-20T06:00:00Z') } });
      const after = await service.setShopPhoto('tenant-1', 'user-1', mockCustomer.id, { buffer: JPEG, mimetype: 'image/jpeg' });
      const [key, body, type] = storage.put.mock.calls[0];
      expect(key).toMatch(new RegExp(`^tenant-1/customers/${mockCustomer.id}/shop-[0-9a-f-]{36}\\.jpg$`));
      expect(body).toBe(JPEG);
      expect(type).toBe('image/jpeg');
      expect(repo.setShopPhotoWithClient).toHaveBeenCalledWith(fakeClient, mockCustomer.id, key, 'image/jpeg');
      expect(after.shopPhoto).not.toBeNull();
      expect(audit.record).toHaveBeenCalledWith(fakeClient, expect.objectContaining({ action: 'update', entityId: mockCustomer.id }));
    });

    it('only a real picture: a PDF, or a file named .jpg that isn’t one, is refused and never stored', async () => {
      repo.findById.mockResolvedValue(mockCustomer);
      await expect(service.setShopPhoto('tenant-1', 'user-1', mockCustomer.id, { buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setShopPhoto('tenant-1', 'user-1', mockCustomer.id, { buffer: Buffer.from('not an image'), mimetype: 'image/jpeg' })).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('no photo yet is a 404, never an empty image', async () => {
      repo.shopPhotoWithClient.mockResolvedValue(null);
      await expect(service.shopPhoto('tenant-1', mockCustomer.id)).rejects.toBeInstanceOf(NotFoundException);
      repo.shopPhotoWithClient.mockResolvedValue({ key: 'k', contentType: 'image/jpeg' });
      storage.get.mockResolvedValue(null);
      await expect(service.shopPhoto('tenant-1', mockCustomer.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('locationOf and isImage', () => {
      expect(locationOf({})).toBeUndefined();
      expect(locationOf({ latitude: null, longitude: null })).toBeNull();
      expect(locationOf({ latitude: 12.3, longitude: 76.6 })).toEqual({ latitude: 12.3, longitude: 76.6 });
      expect(() => locationOf({ latitude: 12.3, longitude: null })).toThrow(BadRequestException);
      expect(isImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 'image/png')).toBe(true);
      expect(isImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'image/webp')).toBe(true);
      expect(isImage(JPEG, 'image/png')).toBe(false);
    });
  });
});
