import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { DisputesService, InvoiceDispute } from './disputes.service';
import { CloseDisputeDto, DisputeNoteDto, ListDisputesQueryDto, RaiseDisputeDto } from './dto/dispute.dto';

// Invoice disputes (client Q&A, finance). Anyone who sees receivables sees
// them; raising one or adding to it is collections work (finance:collect);
// closing one is a finance decision (finance:manage).
@ApiTags('finance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('finance/disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  @RequirePermissions('finance:read')
  list(@CurrentUser() user: AuthContext, @Query() query: ListDisputesQueryDto): Promise<InvoiceDispute[]> {
    return this.disputes.list(user.tenantId, query);
  }

  @Post()
  @RequirePermissions('finance:collect')
  raise(@CurrentUser() user: AuthContext, @Body() dto: RaiseDisputeDto): Promise<InvoiceDispute> {
    return this.disputes.raise(user.tenantId, user.userId, dto);
  }

  @Post(':id/notes')
  @HttpCode(200)
  @RequirePermissions('finance:collect')
  addNote(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DisputeNoteDto): Promise<InvoiceDispute> {
    return this.disputes.addNote(user.tenantId, user.userId, id, dto.note);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  close(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseDisputeDto): Promise<InvoiceDispute> {
    return this.disputes.close(user.tenantId, user.userId, id, dto);
  }
}
