import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './repositories/orders.repository';
import { CustomersModule } from '../customers/customers.module';
import { ProductsModule } from '../products/products.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FinanceModule } from '../finance/finance.module';

// Bounded context: Orders — customer order creation, pricing, credit
// checks, stock reservation, and the approval gate at confirmation. Owns
// commerce.customer_order(_line); reaches Customers/Products for
// validation and pricing, Procurement for stock reservation against
// commerce.lot (its public service API only — never LotsRepository
// directly, Constitution I.3-I.4), and Approvals for the customer_order
// sign-off gate, the same two-phase pattern Procurement itself uses.
// Finance issues the invoice at delivery and supplies the receivable
// balance the credit check needs.
@Module({
  imports: [CustomersModule, ProductsModule, ProcurementModule, ApprovalsModule, FinanceModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService],
})
export class OrdersModule {}
