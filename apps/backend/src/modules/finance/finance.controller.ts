import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { FinanceService } from './finance.service';
import { ReceivablesService } from './receivables.service';
import { PayablesService } from './payables.service';
import { FinanceCostsService } from './finance-costs.service';
import { CashFlowReport, PayableLot, PayablesReport, ReceivablesReport, TripCashReport } from './entities/finance.entity';
import {
  CustomerCreditStatus,
  CustomerPaymentRecord,
  CustomerStatement,
  FarmerPaymentRecord,
  FinanceChargeRecord,
  FinanceChargeRunResult,
  FinanceCostRecord,
  FinanceCostsReport,
  InvoiceRecord,
  TrialBalance,
} from './entities/finance-engine.entity';
import { RecordCustomerPaymentDto } from './dto/record-customer-payment.dto';
import { RecordFarmerPaymentDto } from './dto/record-farmer-payment.dto';
import { RecordFinanceCostDto } from './dto/record-finance-cost.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';
import { AsOfQueryDto, RunFinanceChargesDto } from './dto/run-finance-charges.dto';
import { CustomerScopedQueryDto, FarmerScopedQueryDto, ListInvoicesQueryDto } from './dto/finance-list-query.dto';

// Reads under finance:read; money in (finance:collect), money out
// (finance:pay), and adjustments (finance:manage) under separate
// permissions so no one role moves money both ways unchecked
// (Constitution V.2). Invoices are never created here: delivery issues
// them (Orders), and finance-charge runs add their own.
@ApiTags('finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly receivables: ReceivablesService,
    private readonly payables: PayablesService,
    private readonly costs: FinanceCostsService,
  ) {}

  // ---- Reports ----

  @Get('receivables')
  @RequirePermissions('finance:read')
  getReceivables(@CurrentUser() user: AuthContext): Promise<ReceivablesReport> {
    return this.financeService.getReceivables(user.tenantId);
  }

  @Get('payables')
  @RequirePermissions('finance:read')
  getPayables(@CurrentUser() user: AuthContext): Promise<PayablesReport> {
    return this.financeService.getPayables(user.tenantId);
  }

  @Get('payables/:farmerId/lots')
  @RequirePermissions('finance:read')
  getPayableLots(
    @CurrentUser() user: AuthContext,
    @Param('farmerId', ParseUUIDPipe) farmerId: string,
  ): Promise<PayableLot[]> {
    return this.financeService.getPayableLots(user.tenantId, farmerId);
  }

  @Get('cash-flow')
  @RequirePermissions('finance:read')
  getCashFlow(@CurrentUser() user: AuthContext, @Query() query: PeriodQueryDto): Promise<CashFlowReport> {
    return this.financeService.getCashFlow(user.tenantId, query);
  }

  @Get('trip-cash')
  @RequirePermissions('finance:read')
  getTripCash(@CurrentUser() user: AuthContext): Promise<TripCashReport> {
    return this.financeService.getTripCash(user.tenantId);
  }

  @Get('ledger/trial-balance')
  @RequirePermissions('finance:read')
  getTrialBalance(@CurrentUser() user: AuthContext, @Query() query: AsOfQueryDto): Promise<TrialBalance> {
    return this.financeService.getTrialBalance(user.tenantId, query.asOf);
  }

  // ---- Customers: credit and statements ----

  @Get('customers/:customerId/credit')
  @RequirePermissions('finance:read')
  getCreditStatus(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<CustomerCreditStatus> {
    return this.financeService.getCreditStatus(user.tenantId, customerId);
  }

  @Get('customers/:customerId/statement')
  @RequirePermissions('finance:read')
  getStatement(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: PeriodQueryDto,
  ): Promise<CustomerStatement> {
    return this.financeService.getStatement(user.tenantId, customerId, query);
  }

  // ---- Invoices (receivables) ----

  @Get('invoices')
  @RequirePermissions('finance:read')
  listInvoices(
    @CurrentUser() user: AuthContext,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<PaginatedResult<InvoiceRecord>> {
    return this.receivables.listInvoices(
      user.tenantId,
      { customerId: query.customerId, state: query.state ?? 'all', kind: query.kind },
      query.page ?? 1,
      query.pageSize ?? 25,
    );
  }

  @Get('invoices/:id')
  @RequirePermissions('finance:read')
  getInvoice(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<InvoiceRecord> {
    return this.receivables.getInvoice(user.tenantId, id);
  }

  // ---- Collections ----

  @Get('customer-payments')
  @RequirePermissions('finance:read')
  listCustomerPayments(
    @CurrentUser() user: AuthContext,
    @Query() query: CustomerScopedQueryDto,
  ): Promise<PaginatedResult<CustomerPaymentRecord>> {
    return this.receivables.listPayments(user.tenantId, query.customerId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get('customer-payments/:id')
  @RequirePermissions('finance:read')
  getCustomerPayment(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerPaymentRecord> {
    return this.receivables.getPayment(user.tenantId, id);
  }

  @Post('customer-payments')
  @RequirePermissions('finance:collect')
  recordCustomerPayment(
    @CurrentUser() user: AuthContext,
    @Body() dto: RecordCustomerPaymentDto,
  ): Promise<CustomerPaymentRecord> {
    return this.receivables.recordPayment(user.tenantId, user.userId, dto);
  }

  @Post('customer-payments/:id/reverse')
  @RequirePermissions('finance:manage')
  reverseCustomerPayment(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePaymentDto,
  ): Promise<CustomerPaymentRecord> {
    return this.receivables.reversePayment(user.tenantId, user.userId, id, dto.reason);
  }

  // ---- Payments to farmers ----

  @Get('farmer-payments')
  @RequirePermissions('finance:read')
  listFarmerPayments(
    @CurrentUser() user: AuthContext,
    @Query() query: FarmerScopedQueryDto,
  ): Promise<PaginatedResult<FarmerPaymentRecord>> {
    return this.payables.listPayments(user.tenantId, query.farmerId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get('farmer-payments/:id')
  @RequirePermissions('finance:read')
  getFarmerPayment(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FarmerPaymentRecord> {
    return this.payables.getPayment(user.tenantId, id);
  }

  @Post('farmer-payments')
  @RequirePermissions('finance:pay')
  recordFarmerPayment(
    @CurrentUser() user: AuthContext,
    @Body() dto: RecordFarmerPaymentDto,
  ): Promise<FarmerPaymentRecord> {
    return this.payables.recordPayment(user.tenantId, user.userId, dto);
  }

  // ---- Finance charges (to customers) ----

  @Get('finance-charges')
  @RequirePermissions('finance:read')
  listFinanceCharges(
    @CurrentUser() user: AuthContext,
    @Query() query: CustomerScopedQueryDto,
  ): Promise<PaginatedResult<FinanceChargeRecord>> {
    return this.receivables.listFinanceCharges(user.tenantId, query.customerId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Post('finance-charges/run')
  @RequirePermissions('finance:manage')
  runFinanceCharges(
    @CurrentUser() user: AuthContext,
    @Body() dto: RunFinanceChargesDto,
  ): Promise<FinanceChargeRunResult> {
    return this.receivables.runFinanceCharges(user.tenantId, user.userId, dto.asOf);
  }

  // ---- Finance costs (the business's own) ----

  @Get('finance-costs')
  @RequirePermissions('finance:read')
  async getFinanceCosts(@CurrentUser() user: AuthContext, @Query() query: PeriodQueryDto): Promise<FinanceCostsReport> {
    const range = await this.financeService.resolveRange(user.tenantId, query);
    return this.costs.report(user.tenantId, range);
  }

  @Post('finance-costs')
  @RequirePermissions('finance:manage')
  recordFinanceCost(@CurrentUser() user: AuthContext, @Body() dto: RecordFinanceCostDto): Promise<FinanceCostRecord> {
    return this.costs.record(user.tenantId, user.userId, dto);
  }
}
