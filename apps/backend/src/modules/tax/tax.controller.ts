import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { TaxService } from './tax.service';
import {
  CustomerTaxRow,
  FarmerTaxRow,
  Gstr1,
  Gstr3b,
  GstRateView,
  ProductTaxRow,
  TaxInvoiceRow,
  TaxProfile,
  TaxReference,
  TdsRegister,
  TdsSectionView,
} from './entities/tax.entity';
import {
  CancelIrnDto,
  CreateGstRateDto,
  CreateTdsSectionDto,
  EndRuleDto,
  QuarterQueryDto,
  RangeQueryDto,
  RecordIrnDto,
  RecordTdsChallanDto,
  RecordTdsDeductionDto,
  SetCustomerTaxDto,
  SetFarmerTaxDto,
  SetProductTaxDto,
  UpdateTaxProfileDto,
} from './dto/tax.dto';

// Reads under tax:read. Changing the rules and registrations
// (tax:configure) is separate from recording what was filed or paid —
// deductions, deposits, IRNs (tax:file).
@ApiTags('tax')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get('reference')
  @RequirePermissions('tax:read')
  reference(): TaxReference {
    return this.tax.reference();
  }

  // ---- Settings ----

  @Get('profile')
  @RequirePermissions('tax:read')
  getProfile(@CurrentUser() user: AuthContext): Promise<TaxProfile> {
    return this.tax.getProfile(user.tenantId);
  }

  @Put('profile')
  @RequirePermissions('tax:configure')
  updateProfile(@CurrentUser() user: AuthContext, @Body() dto: UpdateTaxProfileDto): Promise<TaxProfile> {
    return this.tax.updateProfile(user.tenantId, user.userId, dto);
  }

  @Get('gst-rates')
  @RequirePermissions('tax:read')
  listGstRates(@CurrentUser() user: AuthContext): Promise<GstRateView[]> {
    return this.tax.listGstRates(user.tenantId);
  }

  @Post('gst-rates')
  @RequirePermissions('tax:configure')
  createGstRate(@CurrentUser() user: AuthContext, @Body() dto: CreateGstRateDto): Promise<GstRateView> {
    return this.tax.createGstRate(user.tenantId, user.userId, dto);
  }

  @Post('gst-rates/:id/end')
  @HttpCode(204)
  @RequirePermissions('tax:configure')
  endGstRate(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndRuleDto): Promise<void> {
    return this.tax.endGstRate(user.tenantId, user.userId, id, dto.effectiveTo);
  }

  @Get('tds-sections')
  @RequirePermissions('tax:read')
  listTdsSections(@CurrentUser() user: AuthContext): Promise<TdsSectionView[]> {
    return this.tax.listTdsSections(user.tenantId);
  }

  @Post('tds-sections')
  @RequirePermissions('tax:configure')
  createTdsSection(@CurrentUser() user: AuthContext, @Body() dto: CreateTdsSectionDto): Promise<TdsSectionView> {
    return this.tax.createTdsSection(user.tenantId, user.userId, dto);
  }

  @Post('tds-sections/:id/end')
  @HttpCode(204)
  @RequirePermissions('tax:configure')
  endTdsSection(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndRuleDto): Promise<void> {
    return this.tax.endTdsSection(user.tenantId, user.userId, id, dto.effectiveTo);
  }

  // ---- Tax details of products and parties ----

  @Get('products')
  @RequirePermissions('tax:read')
  listProducts(@CurrentUser() user: AuthContext): Promise<ProductTaxRow[]> {
    return this.tax.listProducts(user.tenantId);
  }

  @Put('products/:id')
  @HttpCode(204)
  @RequirePermissions('tax:configure')
  setProduct(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetProductTaxDto): Promise<void> {
    return this.tax.setProductTax(user.tenantId, user.userId, id, dto);
  }

  @Get('customers')
  @RequirePermissions('tax:read')
  listCustomers(@CurrentUser() user: AuthContext): Promise<CustomerTaxRow[]> {
    return this.tax.listCustomers(user.tenantId);
  }

  @Put('customers/:id')
  @HttpCode(204)
  @RequirePermissions('tax:configure')
  setCustomer(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCustomerTaxDto): Promise<void> {
    return this.tax.setCustomerTax(user.tenantId, user.userId, id, dto);
  }

  @Get('farmers')
  @RequirePermissions('tax:read')
  listFarmers(@CurrentUser() user: AuthContext): Promise<FarmerTaxRow[]> {
    return this.tax.listFarmers(user.tenantId);
  }

  @Put('farmers/:id')
  @HttpCode(204)
  @RequirePermissions('tax:configure')
  setFarmer(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFarmerTaxDto): Promise<void> {
    return this.tax.setFarmerTax(user.tenantId, user.userId, id, dto);
  }

  // ---- GST ----

  @Get('invoices')
  @RequirePermissions('tax:read')
  listInvoices(@CurrentUser() user: AuthContext, @Query() query: RangeQueryDto): Promise<TaxInvoiceRow[]> {
    return this.tax.listInvoices(user.tenantId, query.from, query.to);
  }

  @Get('gstr1')
  @RequirePermissions('tax:read')
  getGstr1(@CurrentUser() user: AuthContext, @Query() query: RangeQueryDto): Promise<Gstr1> {
    return this.tax.getGstr1(user.tenantId, query.from, query.to);
  }

  @Get('gstr3b')
  @RequirePermissions('tax:read')
  getGstr3b(@CurrentUser() user: AuthContext, @Query() query: RangeQueryDto): Promise<Gstr3b> {
    return this.tax.getGstr3b(user.tenantId, query.from, query.to);
  }

  // ---- E-invoicing ----

  @Get('einvoices/:invoiceId/json')
  @RequirePermissions('tax:read')
  getEinvoiceJson(@CurrentUser() user: AuthContext, @Param('invoiceId', ParseUUIDPipe) invoiceId: string): Promise<Record<string, unknown>> {
    return this.tax.getEinvoiceJson(user.tenantId, invoiceId);
  }

  @Post('einvoices/:invoiceId/irn')
  @HttpCode(204)
  @RequirePermissions('tax:file')
  recordIrn(
    @CurrentUser() user: AuthContext,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: RecordIrnDto,
  ): Promise<void> {
    return this.tax.recordIrn(user.tenantId, user.userId, invoiceId, dto);
  }

  @Post('einvoices/:invoiceId/cancel')
  @HttpCode(204)
  @RequirePermissions('tax:file')
  cancelIrn(
    @CurrentUser() user: AuthContext,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: CancelIrnDto,
  ): Promise<void> {
    return this.tax.cancelIrn(user.tenantId, user.userId, invoiceId, dto);
  }

  // ---- TDS ----

  @Get('tds/register')
  @RequirePermissions('tax:read')
  getTdsRegister(@CurrentUser() user: AuthContext, @Query() query: QuarterQueryDto): Promise<TdsRegister> {
    return this.tax.getTdsRegister(user.tenantId, query.fy, query.quarter);
  }

  @Post('tds/deductions')
  @RequirePermissions('tax:file')
  recordDeduction(@CurrentUser() user: AuthContext, @Body() dto: RecordTdsDeductionDto): Promise<{ id: string; tdsAmount: string; netPaid: string }> {
    return this.tax.recordTdsDeduction(user.tenantId, user.userId, dto);
  }

  @Post('tds/challans')
  @RequirePermissions('tax:file')
  recordChallan(@CurrentUser() user: AuthContext, @Body() dto: RecordTdsChallanDto): Promise<{ id: string; taxAmount: string }> {
    return this.tax.recordChallan(user.tenantId, user.userId, dto);
  }
}
