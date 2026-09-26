import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProcurementService } from './procurement.service';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { PickupsRepository } from './repositories/pickups.repository';
import { LotsRepository } from './repositories/lots.repository';
import { FarmerSettlementsRepository } from './repositories/farmer-settlements.repository';
import { FarmersService } from '../farmers/farmers.service';
import { ProductsService } from '../products/products.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { WorkforceService } from '../workforce/workforce.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { PurchaseOrderRecord } from './entities/purchase-order.entity';
import { LotRecord } from './entities/lot.entity';

const fakeClient = {} as PoolClient;

const basePo: PurchaseOrderRecord = {
  id: 'po-1',
  tenantId: 'tenant-1',
  farmerId: 'farmer-1',
  status: 'placed',
  expectedDeliveryDate: null,
  approvalRequestId: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
  lines: [{ id: 'line-1', purchaseOrderId: 'po-1', productId: 'product-1', expectedQuantity: '100', indicativePrice: '10' }],
};

const baseLot: LotRecord = {
  id: 'lot-1',
  tenantId: 'tenant-1',
  purchaseOrderId: 'po-1',
  farmerId: 'farmer-1',
  productId: 'product-1',
  pickupId: null,
  receivedQuantity: '100',
  acceptedQuantity: null,
  rejectedQuantity: null,
  grade: null,
  rejectionReason: null,
  unitCost: null,
  status: 'received_ungraded',
  reservedForOrderLineId: null,
  currentQuantity: null,
  currentLocationId: null,
  receivedAt: new Date(),
  gradedAt: null,
  gradedBy: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

describe('ProcurementService', () => {
  let service: ProcurementService;
  let purchaseOrders: jest.Mocked<PurchaseOrdersRepository>;
  let pickups: jest.Mocked<PickupsRepository>;
  let lots: jest.Mocked<LotsRepository>;
  let settlements: jest.Mocked<FarmerSettlementsRepository>;
  let farmers: jest.Mocked<FarmersService>;
  let products: jest.Mocked<ProductsService>;
  let approvals: jest.Mocked<ApprovalsService>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProcurementService,
        {
          provide: PurchaseOrdersRepository,
          useValue: {
            list: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            computeEstimatedValueWithClient: jest.fn(),
            setApprovalRequestWithClient: jest.fn(),
            confirmWithClient: jest.fn(),
            cancelWithClient: jest.fn(),
            markReceivedWithClient: jest.fn(),
            markGradedWithClient: jest.fn(),
            closeWithClient: jest.fn(),
          },
        },
        {
          provide: PickupsRepository,
          useValue: {
            listByPurchaseOrder: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            completeWithClient: jest.fn(),
            cancelWithClient: jest.fn(),
          },
        },
        {
          provide: LotsRepository,
          useValue: {
            listByPurchaseOrder: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            gradeWithClient: jest.fn(),
            countUngradedWithClient: jest.fn(),
            countUnsettledAvailableWithClient: jest.fn(),
          },
        },
        {
          provide: FarmerSettlementsRepository,
          useValue: {
            listByPurchaseOrder: jest.fn(),
            findByLotId: jest.fn(),
            createWithClient: jest.fn(),
          },
        },
        { provide: FarmersService, useValue: { getById: jest.fn() } },
        { provide: ProductsService, useValue: { getById: jest.fn() } },
        { provide: VehiclesService, useValue: { getById: jest.fn() } },
        { provide: WorkforceService, useValue: { getById: jest.fn() } },
        {
          provide: ApprovalsService,
          useValue: { evaluate: jest.fn(), getRequest: jest.fn() },
        },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProcurementService);
    purchaseOrders = module.get(PurchaseOrdersRepository);
    pickups = module.get(PickupsRepository);
    lots = module.get(LotsRepository);
    settlements = module.get(FarmerSettlementsRepository);
    farmers = module.get(FarmersService);
    products = module.get(ProductsService);
    approvals = module.get(ApprovalsService);
    audit = module.get(AuditService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('createPurchaseOrder validates the farmer and every line product before writing', async () => {
    purchaseOrders.createWithClient.mockResolvedValue(basePo);

    await service.createPurchaseOrder('tenant-1', 'user-1', {
      farmerId: 'farmer-1',
      lines: [{ productId: 'product-1', expectedQuantity: 100, indicativePrice: 10 }],
    });

    expect(farmers.getById).toHaveBeenCalledWith('tenant-1', 'farmer-1');
    expect(products.getById).toHaveBeenCalledWith('tenant-1', 'product-1');
    expect(audit.record).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({ action: 'create', entityType: 'purchase_order' }),
    );
  });

  it('confirmPurchaseOrder confirms directly when no approval rule is triggered', async () => {
    purchaseOrders.findById.mockResolvedValue(basePo);
    purchaseOrders.computeEstimatedValueWithClient.mockResolvedValue(1000);
    approvals.evaluate.mockResolvedValue({ required: false });
    purchaseOrders.confirmWithClient.mockResolvedValue({ ...basePo, status: 'confirmed', version: 2 });

    const result = await service.confirmPurchaseOrder('tenant-1', 'user-1', 'po-1', { version: 1 });

    expect(approvals.evaluate).toHaveBeenCalledWith('tenant-1', 'user-1', {
      actionType: 'purchase_order',
      subjectId: 'po-1',
      amount: 1000,
    });
    expect(purchaseOrders.setApprovalRequestWithClient).not.toHaveBeenCalled();
    expect(result.status).toBe('confirmed');
  });

  it('confirmPurchaseOrder leaves the order placed with an approval_request_id when required', async () => {
    purchaseOrders.findById.mockResolvedValue(basePo);
    purchaseOrders.computeEstimatedValueWithClient.mockResolvedValue(60000);
    approvals.evaluate.mockResolvedValue({
      required: true,
      request: { id: 'req-1' } as never,
    });
    purchaseOrders.setApprovalRequestWithClient.mockResolvedValue({
      ...basePo,
      approvalRequestId: 'req-1',
      version: 2,
    });

    const result = await service.confirmPurchaseOrder('tenant-1', 'user-1', 'po-1', { version: 1 });

    expect(purchaseOrders.confirmWithClient).not.toHaveBeenCalled();
    expect(result.status).toBe('placed');
    expect(result.approvalRequestId).toBe('req-1');
  });

  it('confirmPurchaseOrder refuses a purchase order that is already awaiting a decision', async () => {
    purchaseOrders.findById.mockResolvedValue({ ...basePo, approvalRequestId: 'req-1' });

    await expect(
      service.confirmPurchaseOrder('tenant-1', 'user-1', 'po-1', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('finalizeConfirmation confirms the order once its approval request is approved', async () => {
    const awaiting = { ...basePo, approvalRequestId: 'req-1' };
    purchaseOrders.findById.mockResolvedValue(awaiting);
    approvals.getRequest.mockResolvedValue({ status: 'approved' } as never);
    purchaseOrders.confirmWithClient.mockResolvedValue({ ...awaiting, status: 'confirmed' });

    const result = await service.finalizeConfirmation('tenant-1', 'user-1', 'po-1');

    expect(purchaseOrders.confirmWithClient).toHaveBeenCalledWith(fakeClient, 'po-1', 1, null);
    expect(result.status).toBe('confirmed');
  });

  it('finalizeConfirmation cancels the order once its approval request is rejected', async () => {
    const awaiting = { ...basePo, approvalRequestId: 'req-1' };
    purchaseOrders.findById.mockResolvedValue(awaiting);
    approvals.getRequest.mockResolvedValue({ status: 'rejected' } as never);
    purchaseOrders.cancelWithClient.mockResolvedValue({ ...awaiting, status: 'cancelled' });

    const result = await service.finalizeConfirmation('tenant-1', 'user-1', 'po-1');

    expect(purchaseOrders.cancelWithClient).toHaveBeenCalledWith(fakeClient, 'po-1', 1);
    expect(result.status).toBe('cancelled');
  });

  it('finalizeConfirmation refuses while the decision is still pending', async () => {
    const awaiting = { ...basePo, approvalRequestId: 'req-1' };
    purchaseOrders.findById.mockResolvedValue(awaiting);
    approvals.getRequest.mockResolvedValue({ status: 'pending' } as never);

    await expect(service.finalizeConfirmation('tenant-1', 'user-1', 'po-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('receiveGoods creates one lot per line and marks the order received', async () => {
    const confirmedPo = { ...basePo, status: 'confirmed' as const };
    purchaseOrders.findById.mockResolvedValue(confirmedPo);
    purchaseOrders.findByIdWithClient.mockResolvedValue(confirmedPo);
    lots.createWithClient.mockResolvedValue(baseLot);
    purchaseOrders.markReceivedWithClient.mockResolvedValue({ ...confirmedPo, status: 'received', version: 2 });

    const result = await service.receiveGoods('tenant-1', 'user-1', 'po-1', {
      lines: [{ productId: 'product-1', receivedQuantity: 100 }],
    });

    expect(result).toHaveLength(1);
    expect(purchaseOrders.markReceivedWithClient).toHaveBeenCalledWith(fakeClient, 'po-1', 1);
  });

  it('receiveGoods rejects a line for a product that is not on the purchase order', async () => {
    purchaseOrders.findById.mockResolvedValue({ ...basePo, status: 'confirmed' });

    await expect(
      service.receiveGoods('tenant-1', 'user-1', 'po-1', {
        lines: [{ productId: 'not-on-the-order', receivedQuantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gradeLot auto-transitions the purchase order to graded once every lot is graded', async () => {
    lots.findByIdWithClient.mockResolvedValue(baseLot);
    lots.gradeWithClient.mockResolvedValue({
      ...baseLot,
      acceptedQuantity: '100',
      rejectedQuantity: '0',
      unitCost: '9.5',
      status: 'available',
      version: 2,
    });
    lots.countUngradedWithClient.mockResolvedValue(0);
    purchaseOrders.findByIdWithClient.mockResolvedValue({ ...basePo, status: 'received' });
    purchaseOrders.markGradedWithClient.mockResolvedValue({ ...basePo, status: 'graded', version: 2 });

    await service.gradeLot('tenant-1', 'user-1', 'lot-1', {
      version: 1,
      acceptedQuantity: 100,
      rejectedQuantity: 0,
      unitCost: 9.5,
    });

    expect(purchaseOrders.markGradedWithClient).toHaveBeenCalledWith(fakeClient, 'po-1', 1);
  });

  it('gradeLot rejects mismatched accepted/rejected quantities', async () => {
    lots.findByIdWithClient.mockResolvedValue(baseLot);

    await expect(
      service.gradeLot('tenant-1', 'user-1', 'lot-1', {
        version: 1,
        acceptedQuantity: 50,
        rejectedQuantity: 40,
        unitCost: 9.5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gradeLot requires unitCost unless the lot is fully rejected', async () => {
    lots.findByIdWithClient.mockResolvedValue(baseLot);

    await expect(
      service.gradeLot('tenant-1', 'user-1', 'lot-1', {
        version: 1,
        acceptedQuantity: 100,
        rejectedQuantity: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('settleFarmer auto-closes the purchase order once every available lot is settled', async () => {
    const availableLot = { ...baseLot, status: 'available' as const };
    lots.findByIdWithClient.mockResolvedValue(availableLot);
    settlements.createWithClient.mockResolvedValue({
      id: 'settlement-1',
      tenantId: 'tenant-1',
      lotId: 'lot-1',
      farmerId: 'farmer-1',
      amount: '950',
      method: 'cash',
      notes: null,
      settledBy: 'user-1',
      settledAt: new Date(),
    });
    purchaseOrders.findByIdWithClient.mockResolvedValue({ ...basePo, status: 'graded' });
    lots.countUnsettledAvailableWithClient.mockResolvedValue(0);
    purchaseOrders.closeWithClient.mockResolvedValue({ ...basePo, status: 'closed', version: 2 });

    await service.settleFarmer('tenant-1', 'user-1', 'lot-1', { amount: 950, method: 'cash' });

    expect(purchaseOrders.closeWithClient).toHaveBeenCalledWith(fakeClient, 'po-1', 1);
  });

  it('settleFarmer refuses to settle a lot that is not available', async () => {
    lots.findByIdWithClient.mockResolvedValue({ ...baseLot, status: 'received_ungraded' });

    await expect(
      service.settleFarmer('tenant-1', 'user-1', 'lot-1', { amount: 950, method: 'cash' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
