import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { AdjustmentsService } from './adjustments.service';
import { AgentsFinanceService } from './agents-finance.service';
import { AdjustmentsQueryDto, IssueCreditNoteDto, WriteOffDto } from './dto/dispute.dto';
import { RecordAgentPaymentDto } from './dto/record-agent-payment.dto';
import { AgentAccount, AgentPaymentRecord, CreditNoteRecord, ReceivableWriteOffRecord } from './entities/finance-engine.entity';

// Master Spec v3 P6. Credit notes and write-offs are finance decisions
// (finance:manage — the owner and a finance lead, BD.2); paying an agent is
// paying out (finance:pay); anyone who sees finance sees all of it.
@ApiTags('finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance')
export class AdjustmentsController {
  constructor(
    private readonly adjustments: AdjustmentsService,
    private readonly agents: AgentsFinanceService,
  ) {}

  @Get('credit-notes')
  @RequirePermissions('finance:read')
  listCreditNotes(@CurrentUser() user: AuthContext, @Query() query: AdjustmentsQueryDto): Promise<CreditNoteRecord[]> {
    return this.adjustments.listCreditNotes(user.tenantId, query);
  }

  @Get('credit-notes/:id')
  @RequirePermissions('finance:read')
  getCreditNote(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<CreditNoteRecord> {
    return this.adjustments.getCreditNote(user.tenantId, id);
  }

  @Post('credit-notes')
  @RequirePermissions('finance:manage')
  issueCreditNote(@CurrentUser() user: AuthContext, @Body() dto: IssueCreditNoteDto): Promise<CreditNoteRecord> {
    return this.adjustments.issueCreditNote(user.tenantId, user.userId, dto);
  }

  @Get('write-offs')
  @RequirePermissions('finance:read')
  listWriteOffs(@CurrentUser() user: AuthContext, @Query() query: AdjustmentsQueryDto): Promise<ReceivableWriteOffRecord[]> {
    return this.adjustments.listWriteOffs(user.tenantId, query.customerId);
  }

  @Post('invoices/:id/write-off')
  @RequirePermissions('finance:manage')
  writeOff(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WriteOffDto): Promise<ReceivableWriteOffRecord> {
    return this.adjustments.writeOff(user.tenantId, user.userId, id, dto);
  }

  @Get('agents')
  @RequirePermissions('finance:read')
  listAgents(@CurrentUser() user: AuthContext): Promise<AgentAccount[]> {
    return this.agents.listAccounts(user.tenantId);
  }

  @Get('agents/:id')
  @RequirePermissions('finance:read')
  getAgent(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<AgentAccount> {
    return this.agents.getAccount(user.tenantId, id);
  }

  @Post('agents/:id/payments')
  @RequirePermissions('finance:pay')
  payAgent(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordAgentPaymentDto): Promise<AgentPaymentRecord> {
    return this.agents.recordPayment(user.tenantId, user.userId, id, dto);
  }
}
