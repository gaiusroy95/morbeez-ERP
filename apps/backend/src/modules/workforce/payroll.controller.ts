import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PayrollService } from './payroll.service';
import { LoginLink, MAX_DOCUMENT_BYTES, UploadedDocument, WorkerAccessService } from './worker-access.service';
import { AddWorkerDto, LoginLinkDto, UploadWorkerDocumentDto } from './dto/worker-access.dto';
import { GST_STATES } from '../../common/india';
import {
  AdvanceRecord,
  AssignmentRecord,
  EarningsPreview,
  IncentiveRule,
  MinimumWageRate,
  PayrollSettings,
  SettlementRecord,
  WorkerDetail,
  WorkerDocument,
  WorkerRow,
} from './entities/payroll.entity';
import {
  CreateAssignmentDto,
  DraftSettlementsDto,
  EarningsQueryDto,
  EndRuleDto,
  IncentiveRuleDto,
  ListAssignmentsQueryDto,
  ListSettlementsQueryDto,
  MinimumWageDto,
  PayRateDto,
  PayrollSettingsDto,
  PaySettlementDto,
  RecordAdvanceDto,
  UpdateAssignmentDto,
  VersionDto,
  VoidSettlementDto,
  WorkerProfileDto,
} from './dto/payroll.dto';

// Who works and what they did: workforce:read / workforce:write. What they
// are paid: payroll:read, with setting rates and rules (payroll:configure),
// drafting pay and advances (payroll:prepare), approving (payroll:approve,
// never one's own draft), and paying (payroll:pay) kept apart
// (Constitution V.2).
@ApiTags('workforce')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workforce')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly access: WorkerAccessService,
  ) {}

  // ---- Adding a worker, their documents, their login (client feedback, Oct 2026) ----

  /** A worker with their phone and address, in one step. */
  @Post('workers')
  @RequirePermissions('workforce:write')
  addWorker(@CurrentUser() user: AuthContext, @Body() dto: AddWorkerDto): Promise<WorkerDetail> {
    return this.access.addWorker(user.tenantId, user.userId, dto);
  }

  @Post('workers/:id/documents')
  @RequirePermissions('workforce:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  addDocument(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadWorkerDocumentDto,
    @UploadedFile() file?: UploadedDocument,
  ): Promise<WorkerDocument> {
    if (!file) throw new BadRequestException('No file attached');
    return this.access.addDocument(user.tenantId, user.userId, id, dto.kind, dto.label ?? null, file);
  }

  /** The document itself, to view in the browser. */
  @Get('workers/:id/documents/:documentId/file')
  @RequirePermissions('workforce:read')
  async documentFile(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.access.documentFile(user.tenantId, id, documentId);
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'private, no-store');
    res.send(file.body);
  }

  @Post('workers/:id/documents/:documentId/remove')
  @HttpCode(200)
  @RequirePermissions('workforce:write')
  removeDocument(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<WorkerDetail> {
    return this.access.removeDocument(user.tenantId, user.userId, id, documentId);
  }

  /**
   * A link for the worker to choose their password — making their login
   * first if they have none. The owner sends it (WhatsApp, SMS).
   */
  @Post('workers/:id/login-link')
  @HttpCode(200)
  @RequirePermissions('users:write')
  loginLink(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LoginLinkDto,
  ): Promise<LoginLink> {
    return this.access.loginLink(user.tenantId, user.userId, id, dto.phone ?? null);
  }

  /** States and union territories by their 2-digit code — for work locations and minimum wages. */
  @Get('states')
  @RequirePermissions('workforce:read')
  states(): { code: string; name: string }[] {
    return Object.entries(GST_STATES).map(([code, name]) => ({ code, name }));
  }

  // ---- Workers ----

  @Get('workers')
  @RequirePermissions('workforce:read')
  listWorkers(@CurrentUser() user: AuthContext): Promise<WorkerRow[]> {
    return this.payroll.listWorkers(user.tenantId);
  }

  @Get('workers/:id')
  @RequirePermissions('workforce:read')
  getWorker(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<WorkerDetail> {
    return this.payroll.getWorker(user.tenantId, id);
  }

  @Put('workers/:id/profile')
  @RequirePermissions('workforce:write')
  saveProfile(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WorkerProfileDto): Promise<WorkerDetail> {
    return this.payroll.saveProfile(user.tenantId, user.userId, id, dto);
  }

  @Post('workers/:id/pay-rates')
  @RequirePermissions('payroll:configure')
  addRate(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayRateDto): Promise<WorkerDetail> {
    return this.payroll.addRate(user.tenantId, user.userId, id, dto);
  }

  // ---- Assignments ----

  @Get('assignments')
  @RequirePermissions('workforce:read')
  listAssignments(@CurrentUser() user: AuthContext, @Query() q: ListAssignmentsQueryDto): Promise<AssignmentRecord[]> {
    return this.payroll.listAssignments(user.tenantId, q.from, q.to, q.employeeId);
  }

  @Post('assignments')
  @RequirePermissions('workforce:write')
  createAssignment(@CurrentUser() user: AuthContext, @Body() dto: CreateAssignmentDto): Promise<AssignmentRecord> {
    return this.payroll.createAssignment(user.tenantId, user.userId, dto);
  }

  @Patch('assignments/:id')
  @RequirePermissions('workforce:write')
  updateAssignment(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
  ): Promise<AssignmentRecord> {
    return this.payroll.updateAssignment(user.tenantId, user.userId, id, dto);
  }

  // ---- Rules and settings ----

  @Get('payroll/settings')
  @RequirePermissions('payroll:read')
  getSettings(@CurrentUser() user: AuthContext): Promise<PayrollSettings> {
    return this.payroll.getSettings(user.tenantId);
  }

  @Put('payroll/settings')
  @RequirePermissions('payroll:configure')
  saveSettings(@CurrentUser() user: AuthContext, @Body() dto: PayrollSettingsDto): Promise<PayrollSettings> {
    return this.payroll.saveSettings(user.tenantId, user.userId, dto);
  }

  @Get('incentive-rules')
  @RequirePermissions('payroll:read')
  listIncentiveRules(@CurrentUser() user: AuthContext): Promise<IncentiveRule[]> {
    return this.payroll.listIncentiveRules(user.tenantId);
  }

  @Post('incentive-rules')
  @RequirePermissions('payroll:configure')
  createIncentiveRule(@CurrentUser() user: AuthContext, @Body() dto: IncentiveRuleDto): Promise<IncentiveRule[]> {
    return this.payroll.createIncentiveRule(user.tenantId, user.userId, dto);
  }

  @Post('incentive-rules/:id/end')
  @HttpCode(204)
  @RequirePermissions('payroll:configure')
  endIncentiveRule(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndRuleDto): Promise<void> {
    return this.payroll.endRule(user.tenantId, user.userId, 'incentive_rule', id, dto.effectiveTo);
  }

  @Get('minimum-wages')
  @RequirePermissions('payroll:read')
  listMinimumWages(@CurrentUser() user: AuthContext): Promise<MinimumWageRate[]> {
    return this.payroll.listMinimumWages(user.tenantId);
  }

  @Post('minimum-wages')
  @RequirePermissions('payroll:configure')
  createMinimumWage(@CurrentUser() user: AuthContext, @Body() dto: MinimumWageDto): Promise<MinimumWageRate[]> {
    return this.payroll.createMinimumWage(user.tenantId, user.userId, dto);
  }

  @Post('minimum-wages/:id/end')
  @HttpCode(204)
  @RequirePermissions('payroll:configure')
  endMinimumWage(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndRuleDto): Promise<void> {
    return this.payroll.endRule(user.tenantId, user.userId, 'minimum_wage_rate', id, dto.effectiveTo);
  }

  // ---- Advances ----

  @Get('advances')
  @RequirePermissions('payroll:read')
  listAdvances(@CurrentUser() user: AuthContext): Promise<AdvanceRecord[]> {
    return this.payroll.listAdvances(user.tenantId);
  }

  @Post('advances')
  @RequirePermissions('payroll:prepare')
  recordAdvance(@CurrentUser() user: AuthContext, @Body() dto: RecordAdvanceDto): Promise<AdvanceRecord[]> {
    return this.payroll.recordAdvance(user.tenantId, user.userId, dto);
  }

  // ---- Earnings and settlements ----

  @Get('earnings')
  @RequirePermissions('payroll:read')
  previewEarnings(@CurrentUser() user: AuthContext, @Query() q: EarningsQueryDto): Promise<EarningsPreview[]> {
    return this.payroll.previewEarnings(user.tenantId, q.from, q.to);
  }

  @Get('settlements')
  @RequirePermissions('payroll:read')
  listSettlements(@CurrentUser() user: AuthContext, @Query() q: ListSettlementsQueryDto): Promise<SettlementRecord[]> {
    return this.payroll.listSettlements(user.tenantId, q);
  }

  @Get('settlements/:id')
  @RequirePermissions('payroll:read')
  getSettlement(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<SettlementRecord> {
    return this.payroll.getSettlement(user.tenantId, id);
  }

  @Post('settlements')
  @RequirePermissions('payroll:prepare')
  draftSettlements(@CurrentUser() user: AuthContext, @Body() dto: DraftSettlementsDto): Promise<SettlementRecord[]> {
    return this.payroll.draftSettlements(user.tenantId, user.userId, dto);
  }

  @Post('settlements/:id/approve')
  @RequirePermissions('payroll:approve')
  approve(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto): Promise<SettlementRecord> {
    return this.payroll.approveSettlement(user.tenantId, user.userId, id, dto.version);
  }

  @Post('settlements/:id/pay')
  @RequirePermissions('payroll:pay')
  pay(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaySettlementDto): Promise<SettlementRecord> {
    return this.payroll.paySettlement(user.tenantId, user.userId, id, dto);
  }

  @Post('settlements/:id/void')
  @RequirePermissions('payroll:approve')
  voidSettlement(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSettlementDto): Promise<SettlementRecord> {
    return this.payroll.voidSettlement(user.tenantId, user.userId, id, dto);
  }
}
