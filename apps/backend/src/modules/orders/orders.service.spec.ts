import { Test } from '@nestjs/testing';
import { PoolClient } from 'pg';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './repositories/orders.repository';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { ProcurementService } from '../procurement/procurement.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ReceivablesService } from '../finance/receivables.service';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { OrderRecord } from './entities/customer-order.entity';
import { CustomerRecord } from '../customers/entities/customer.entity';
import { ProductRecord } from '../products/entities/product.entity';

const fakeClient = {} as PoolClient;

const baseOrder: OrderRecord = {
  id: 'order-1',
  tenantId: 'tenant-1',
  customerId: 'customer-1',
  status: 'placed',
  approvalRequestId: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
  lines: [{ id: 'line-1', orderId: 'order-1', productId: 'product-1', quantity: '10', unitPrice: '50' }],
};

const baseCustomer: CustomerRecord = {
  id: 'customer-1',
  tenantId: 'tenant-1',
  name: 'Test Customer',
  contact: {},
  creditLimit: '1000',
  paymentTermsDays: 30,
  financeChargeRateMonthly: '0.00',
  financeChargeGraceDays: 0,
  creditHold: false,
  creditHoldReason: null,
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

const baseProduct: ProductRecord = {
  id: 'product-1',
  tenantId: 'tenant-1',
  name: 'Tomato',
  category: 'vegetable',
  baseUom: 'kg',
  basePrice: '50',
  status: 'active',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-1',
};

describe('OrdersService', () => {
  let service: OrdersService;
  let orders: jest.Mocked<OrdersRepository>;
  let customers: jest.Mocked<CustomersService>;
  let products: jest.Mocked<ProductsService>;
  let procurement: jest.Mocked<ProcurementService>;
  let approvals: jest.Mocked<ApprovalsService>;
  let receivables: jest.Mocked<ReceivablesService>;
  let audit: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: OrdersRepository,
          useValue: {
            list: jest.fn(),
            findById: jest.fn(),
            findByIdWithClient: jest.fn(),
            createWithClient: jest.fn(),
            computeTotalWithClient: jest.fn(),
            computeCustomerExposureWithClient: jest.fn(),
            setApprovalRequestWithClient: jest.fn(),
            confirmWithClient: jest.fn(),
            cancelWithClient: jest.fn(),
            deliverWithClient: jest.fn(),
          },
        },
        { provide: CustomersService, useValue: { getById: jest.fn() } },
        { provide: ProductsService, useValue: { getById: jest.fn() } },
        {
          provide: ProcurementService,
          useValue: {
            reserveLotsForOrderLineWithClient: jest.fn(),
            releaseLotsForOrderLine: jest.fn(),
            consumeLotsForOrderLineWithClient: jest.fn(),
          },
        },
        {
          provide: ReceivablesService,
          useValue: {
            customerBalanceWithClient: jest.fn().mockResolvedValue({
              invoicedOutstanding: '0.00',
              unappliedCredit: '0.00',
              balance: '0.00',
              overdue: '0.00',
              oldestOverdueDays: null,
            }),
            issueSaleInvoiceWithClient: jest.fn(),
          },
        },
        { provide: ApprovalsService, useValue: { evaluate: jest.fn(), getRequest: jest.fn() } },
        {
          provide: DatabaseService,
          useValue: { withTenant: jest.fn((_tenantId, work) => work(fakeClient)) },
        },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(OrdersService);
    orders = module.get(OrdersRepository);
    customers = module.get(CustomersService);
    products = module.get(ProductsService);
    procurement = module.get(ProcurementService);
    approvals = module.get(ApprovalsService);
    receivables = module.get(ReceivablesService);
    audit = module.get(AuditService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  it('createOrder prices a line from basePrice when unitPrice is omitted', async () => {
    customers.getById.mockResolvedValue(baseCustomer);
    products.getById.mockResolvedValue(baseProduct);
    orders.createWithClient.mockResolvedValue(baseOrder);

    await service.createOrder('tenant-1', 'user-1', {
      customerId: 'customer-1',
      lines: [{ productId: 'product-1', quantity: 10 }],
    });

    expect(orders.createWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({ lines: [{ productId: 'product-1', quantity: 10, unitPrice: 50 }] }),
    );
  });

  it('createOrder refuses an archived customer', async () => {
    customers.getById.mockResolvedValue({ ...baseCustomer, status: 'archived' });

    await expect(
      service.createOrder('tenant-1', 'user-1', {
        customerId: 'customer-1',
        lines: [{ productId: 'product-1', quantity: 10 }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('confirmOrder blocks when the order would exceed the customer credit limit', async () => {
    orders.findById.mockResolvedValue(baseOrder);
    orders.computeTotalWithClient.mockResolvedValue(500);
    customers.getById.mockResolvedValue({ ...baseCustomer, creditLimit: '400' });
    orders.computeCustomerExposureWithClient.mockResolvedValue(0);

    await expect(service.confirmOrder('tenant-1', 'user-1', 'order-1', { version: 1 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(approvals.evaluate).not.toHaveBeenCalled();
  });

  it('confirmOrder counts what the customer already owes toward the credit limit', async () => {
    orders.findById.mockResolvedValue(baseOrder);
    orders.computeTotalWithClient.mockResolvedValue(500);
    customers.getById.mockResolvedValue({ ...baseCustomer, creditLimit: '1000' });
    orders.computeCustomerExposureWithClient.mockResolvedValue(200);
    receivables.customerBalanceWithClient.mockResolvedValue({
      invoicedOutstanding: '450.00',
      unappliedCredit: '50.00',
      balance: '400.00',
      overdue: '0.00',
      oldestOverdueDays: null,
    });

    // owed 400 + other open orders 200 + this order 500 = 1100 > 1000
    await expect(service.confirmOrder('tenant-1', 'user-1', 'order-1', { version: 1 })).rejects.toThrow(
      /owed 400\.00, other open orders 200\.00, this order 500\.00/,
    );
    expect(procurement.reserveLotsForOrderLineWithClient).not.toHaveBeenCalled();
  });

  it('confirmOrder refuses a customer on credit hold, whatever the limit', async () => {
    orders.findById.mockResolvedValue(baseOrder);
    orders.computeTotalWithClient.mockResolvedValue(10);
    customers.getById.mockResolvedValue({
      ...baseCustomer,
      creditLimit: '1000000',
      creditHold: true,
      creditHoldReason: 'Cheque bounced twice',
    });

    await expect(service.confirmOrder('tenant-1', 'user-1', 'order-1', { version: 1 })).rejects.toThrow(
      /credit hold: Cheque bounced twice/,
    );
  });

  it('confirmOrder reserves stock for every line and confirms when no approval is required', async () => {
    orders.findById.mockResolvedValue(baseOrder);
    orders.findByIdWithClient.mockResolvedValue(baseOrder);
    orders.computeTotalWithClient.mockResolvedValue(500);
    customers.getById.mockResolvedValue(baseCustomer);
    orders.computeCustomerExposureWithClient.mockResolvedValue(0);
    approvals.evaluate.mockResolvedValue({ required: false });
    procurement.reserveLotsForOrderLineWithClient.mockResolvedValue([]);
    orders.confirmWithClient.mockResolvedValue({ ...baseOrder, status: 'confirmed', version: 2 });

    const result = await service.confirmOrder('tenant-1', 'user-1', 'order-1', { version: 1 });

    expect(procurement.reserveLotsForOrderLineWithClient).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'user-1', {
      orderLineId: 'line-1',
      productId: 'product-1',
      quantity: 10,
    });
    expect(result.status).toBe('confirmed');
  });

  it('confirmOrder leaves the order placed with an approval_request_id when required', async () => {
    orders.findById.mockResolvedValue(baseOrder);
    orders.computeTotalWithClient.mockResolvedValue(500);
    customers.getById.mockResolvedValue(baseCustomer);
    orders.computeCustomerExposureWithClient.mockResolvedValue(0);
    approvals.evaluate.mockResolvedValue({ required: true, request: { id: 'req-1' } as never });
    orders.setApprovalRequestWithClient.mockResolvedValue({
      ...baseOrder,
      approvalRequestId: 'req-1',
      version: 2,
    });

    const result = await service.confirmOrder('tenant-1', 'user-1', 'order-1', { version: 1 });

    expect(procurement.reserveLotsForOrderLineWithClient).not.toHaveBeenCalled();
    expect(result.status).toBe('placed');
    expect(result.approvalRequestId).toBe('req-1');
  });

  it('confirmOrder reserves every line in one transaction: a later line that can’t be covered leaves nothing reserved (PA-03)', async () => {
    const twoLineOrder: OrderRecord = {
      ...baseOrder,
      lines: [
        { id: 'line-1', orderId: 'order-1', productId: 'product-1', quantity: '10', unitPrice: '50' },
        { id: 'line-2', orderId: 'order-1', productId: 'product-2', quantity: '5', unitPrice: '20' },
      ],
    };
    orders.findById.mockResolvedValue(twoLineOrder);
    orders.findByIdWithClient.mockResolvedValue(twoLineOrder);
    orders.computeTotalWithClient.mockResolvedValue(600);
    customers.getById.mockResolvedValue(baseCustomer);
    orders.computeCustomerExposureWithClient.mockResolvedValue(0);
    approvals.evaluate.mockResolvedValue({ required: false });
    procurement.reserveLotsForOrderLineWithClient.mockResolvedValueOnce([]).mockRejectedValueOnce(new ConflictException('short'));

    await expect(service.confirmOrder('tenant-1', 'user-1', 'order-1', { version: 1 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    // The throw rolls the shared transaction back — no reservation to undo by hand.
    expect(procurement.reserveLotsForOrderLineWithClient).toHaveBeenCalledTimes(2);
    expect(procurement.releaseLotsForOrderLine).not.toHaveBeenCalled();
    expect(orders.confirmWithClient).not.toHaveBeenCalled();
  });

  it('finalizeConfirmation reserves stock and confirms once the approval request is approved', async () => {
    const awaiting = { ...baseOrder, approvalRequestId: 'req-1' };
    orders.findById.mockResolvedValue(awaiting);
    orders.findByIdWithClient.mockResolvedValue(awaiting);
    approvals.getRequest.mockResolvedValue({ status: 'approved' } as never);
    procurement.reserveLotsForOrderLineWithClient.mockResolvedValue([]);
    orders.confirmWithClient.mockResolvedValue({ ...awaiting, status: 'confirmed' });
    orders.computeTotalWithClient.mockResolvedValue(500);
    orders.computeCustomerExposureWithClient.mockResolvedValue(0);
    customers.getById.mockResolvedValue(baseCustomer);

    const result = await service.finalizeConfirmation('tenant-1', 'user-1', 'order-1');

    expect(result.status).toBe('confirmed');
  });

  it('finalizeConfirmation re-checks credit: an approved order still cannot pass a hold placed since', async () => {
    const awaiting = { ...baseOrder, approvalRequestId: 'req-1' };
    orders.findById.mockResolvedValue(awaiting);
    approvals.getRequest.mockResolvedValue({ status: 'approved' } as never);
    orders.computeTotalWithClient.mockResolvedValue(500);
    customers.getById.mockResolvedValue({ ...baseCustomer, creditHold: true, creditHoldReason: 'Overdue 60+ days' });

    await expect(service.finalizeConfirmation('tenant-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(ConflictException);
    expect(procurement.reserveLotsForOrderLineWithClient).not.toHaveBeenCalled();
  });

  it('finalizeConfirmation cancels the order once the approval request is rejected', async () => {
    const awaiting = { ...baseOrder, approvalRequestId: 'req-1' };
    orders.findById.mockResolvedValue(awaiting);
    approvals.getRequest.mockResolvedValue({ status: 'rejected' } as never);
    orders.cancelWithClient.mockResolvedValue({ ...awaiting, status: 'cancelled' });

    const result = await service.finalizeConfirmation('tenant-1', 'user-1', 'order-1');

    expect(procurement.reserveLotsForOrderLineWithClient).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('finalizeConfirmation refuses an order that is not awaiting a decision', async () => {
    orders.findById.mockResolvedValue(baseOrder);

    await expect(service.finalizeConfirmation('tenant-1', 'user-1', 'order-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cancelOrder releases every reserved lot when cancelling a confirmed order', async () => {
    const confirmedOrder: OrderRecord = { ...baseOrder, status: 'confirmed' };
    orders.findById.mockResolvedValue(confirmedOrder);
    orders.cancelWithClient.mockResolvedValue({ ...confirmedOrder, status: 'cancelled' });

    await service.cancelOrder('tenant-1', 'user-1', 'order-1', { version: 1 });

    expect(procurement.releaseLotsForOrderLine).toHaveBeenCalledWith('tenant-1', 'user-1', 'line-1');
  });

  it('cancelOrder does not attempt any release for an order that was never confirmed', async () => {
    orders.findById.mockResolvedValue(baseOrder);
    orders.cancelWithClient.mockResolvedValue({ ...baseOrder, status: 'cancelled' });

    await service.cancelOrder('tenant-1', 'user-1', 'order-1', { version: 1 });

    expect(procurement.releaseLotsForOrderLine).not.toHaveBeenCalled();
  });

  it('markDelivered consumes lots and has Finance invoice the order, in one transaction', async () => {
    const confirmed: OrderRecord = {
      ...baseOrder,
      status: 'confirmed',
      lines: [
        { id: 'line-1', orderId: 'order-1', productId: 'product-1', quantity: '10.000', unitPrice: '50.00' },
        { id: 'line-2', orderId: 'order-1', productId: 'product-1', quantity: '4.000', unitPrice: '55.00' },
      ],
    };
    orders.findById.mockResolvedValue(confirmed);
    orders.findByIdWithClient.mockResolvedValue(confirmed);
    orders.deliverWithClient.mockResolvedValue({ ...confirmed, status: 'delivered', version: 2 });
    products.getById.mockResolvedValue(baseProduct);
    procurement.consumeLotsForOrderLineWithClient.mockResolvedValueOnce('320.50').mockResolvedValueOnce('130.25');

    const result = await service.markDelivered('tenant-1', 'user-1', 'order-1', 1);

    expect(result.status).toBe('delivered');
    expect(procurement.consumeLotsForOrderLineWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', 'line-1', '10.000');
    expect(procurement.consumeLotsForOrderLineWithClient).toHaveBeenCalledWith(fakeClient, 'tenant-1', 'user-1', 'line-2', '4.000');
    expect(receivables.issueSaleInvoiceWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({
        orderId: 'order-1',
        customerId: 'customer-1',
        costOfGoods: '450.75',
        lines: [
          expect.objectContaining({ orderLineId: 'line-1', description: 'Tomato', quantity: '10.000', unitPrice: '50.00' }),
          expect.objectContaining({ orderLineId: 'line-2', description: 'Tomato', quantity: '4.000', unitPrice: '55.00' }),
        ],
      }),
    );
  });

  it('markDelivered passes no cost of goods when no delivered lot was costed', async () => {
    const confirmed: OrderRecord = { ...baseOrder, status: 'confirmed' };
    orders.findById.mockResolvedValue(confirmed);
    orders.findByIdWithClient.mockResolvedValue(confirmed);
    orders.deliverWithClient.mockResolvedValue({ ...confirmed, status: 'delivered', version: 2 });
    products.getById.mockResolvedValue(baseProduct);
    procurement.consumeLotsForOrderLineWithClient.mockResolvedValue(null);

    await service.markDelivered('tenant-1', 'user-1', 'order-1', 1);

    expect(receivables.issueSaleInvoiceWithClient).toHaveBeenCalledWith(
      fakeClient,
      'tenant-1',
      'user-1',
      expect.objectContaining({ costOfGoods: null }),
    );
  });
});
