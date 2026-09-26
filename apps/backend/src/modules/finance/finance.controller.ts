import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { FinanceService } from './finance.service';
import {
  CashFlowReport,
  PayablesReport,
  ReceivablesReport,
  TripCashReport,
  UnsettledLot,
} from './entities/finance.entity';

// Read-only. Recording collections, settlements, and reconciliations stays
// with the module that owns each (Logistics, Procurement) — Finance only
// reports on them.
@ApiTags('finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

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
  getUnsettledLots(
    @CurrentUser() user: AuthContext,
    @Param('farmerId', ParseUUIDPipe) farmerId: string,
  ): Promise<UnsettledLot[]> {
    return this.financeService.getUnsettledLots(user.tenantId, farmerId);
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
}
