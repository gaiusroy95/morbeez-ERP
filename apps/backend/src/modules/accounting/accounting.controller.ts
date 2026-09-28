import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PeriodQueryDto } from '../../common/dto/period-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { AccountingService } from './accounting.service';
import {
  AccountingTrialBalance,
  AccountRecord,
  BalanceSheet,
  CashFlowStatement,
  ClosePreview,
  GeneralLedger,
  JournalEntry,
  PeriodsOverview,
  ProfitAndLoss,
} from './entities/accounting.entity';
import { CreateAccountDto, ListAccountsQueryDto, UpdateAccountDto } from './dto/account.dto';
import {
  AsOfQueryDto,
  ClosePeriodDto,
  ClosePreviewQueryDto,
  CreateJournalDto,
  ListJournalQueryDto,
  ReopenPeriodDto,
  ReverseJournalDto,
} from './dto/journal.dto';

// Reads under accounting:read. Posting journals (accounting:post), changing
// the chart (accounting:manage), and closing periods (accounting:close) are
// separate, so the person who posts entries isn't automatically the one
// who can lock or unlock the books (Constitution V.2).
@ApiTags('accounting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  // ---- Chart of accounts ----

  @Get('accounts')
  @RequirePermissions('accounting:read')
  listAccounts(@CurrentUser() user: AuthContext, @Query() query: ListAccountsQueryDto): Promise<AccountRecord[]> {
    return this.accounting.listAccounts(user.tenantId, query.includeInactive ?? false);
  }

  @Post('accounts')
  @RequirePermissions('accounting:manage')
  createAccount(@CurrentUser() user: AuthContext, @Body() dto: CreateAccountDto): Promise<AccountRecord> {
    return this.accounting.createAccount(user.tenantId, user.userId, dto);
  }

  @Patch('accounts/:code')
  @RequirePermissions('accounting:manage')
  updateAccount(
    @CurrentUser() user: AuthContext,
    @Param('code') code: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountRecord> {
    return this.accounting.updateAccount(user.tenantId, user.userId, code, dto);
  }

  // ---- Journal entries ----

  @Get('journal-entries')
  @RequirePermissions('accounting:read')
  listEntries(
    @CurrentUser() user: AuthContext,
    @Query() query: ListJournalQueryDto,
  ): Promise<PaginatedResult<JournalEntry> & { from: string; to: string }> {
    return this.accounting.listEntries(user.tenantId, query);
  }

  @Get('journal-entries/:id')
  @RequirePermissions('accounting:read')
  getEntry(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<JournalEntry> {
    return this.accounting.getEntry(user.tenantId, id);
  }

  @Post('journal-entries')
  @RequirePermissions('accounting:post')
  createJournal(@CurrentUser() user: AuthContext, @Body() dto: CreateJournalDto): Promise<JournalEntry> {
    return this.accounting.createJournal(user.tenantId, user.userId, dto);
  }

  @Post('journal-entries/:id/reverse')
  @RequirePermissions('accounting:post')
  reverseJournal(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseJournalDto,
  ): Promise<JournalEntry> {
    return this.accounting.reverseJournal(user.tenantId, user.userId, id, dto);
  }

  // ---- Ledger and statements ----

  @Get('ledger/:code')
  @RequirePermissions('accounting:read')
  getGeneralLedger(
    @CurrentUser() user: AuthContext,
    @Param('code') code: string,
    @Query() query: PeriodQueryDto,
  ): Promise<GeneralLedger> {
    return this.accounting.getGeneralLedger(user.tenantId, code, query);
  }

  @Get('trial-balance')
  @RequirePermissions('accounting:read')
  getTrialBalance(@CurrentUser() user: AuthContext, @Query() query: AsOfQueryDto): Promise<AccountingTrialBalance> {
    return this.accounting.getTrialBalance(user.tenantId, query.asOf);
  }

  @Get('profit-and-loss')
  @RequirePermissions('accounting:read')
  getProfitAndLoss(@CurrentUser() user: AuthContext, @Query() query: PeriodQueryDto): Promise<ProfitAndLoss> {
    return this.accounting.getProfitAndLoss(user.tenantId, query);
  }

  @Get('balance-sheet')
  @RequirePermissions('accounting:read')
  getBalanceSheet(@CurrentUser() user: AuthContext, @Query() query: AsOfQueryDto): Promise<BalanceSheet> {
    return this.accounting.getBalanceSheet(user.tenantId, query.asOf);
  }

  @Get('cash-flow')
  @RequirePermissions('accounting:read')
  getCashFlow(@CurrentUser() user: AuthContext, @Query() query: PeriodQueryDto): Promise<CashFlowStatement> {
    return this.accounting.getCashFlowStatement(user.tenantId, query);
  }

  // ---- Periods ----

  @Get('periods')
  @RequirePermissions('accounting:read')
  getPeriods(@CurrentUser() user: AuthContext): Promise<PeriodsOverview> {
    return this.accounting.getPeriods(user.tenantId);
  }

  @Get('periods/close-preview')
  @RequirePermissions('accounting:read')
  getClosePreview(@CurrentUser() user: AuthContext, @Query() query: ClosePreviewQueryDto): Promise<ClosePreview> {
    return this.accounting.getClosePreview(user.tenantId, query.through);
  }

  @Post('periods/close')
  @RequirePermissions('accounting:close')
  closePeriod(@CurrentUser() user: AuthContext, @Body() dto: ClosePeriodDto): Promise<PeriodsOverview> {
    return this.accounting.closePeriod(user.tenantId, user.userId, dto);
  }

  @Post('periods/:id/reopen')
  @RequirePermissions('accounting:close')
  reopenPeriod(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenPeriodDto,
  ): Promise<PeriodsOverview> {
    return this.accounting.reopenPeriod(user.tenantId, user.userId, id, dto);
  }
}
