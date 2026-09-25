import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { WorkforceService } from './workforce.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeRecord } from './entities/employee.entity';

@ApiTags('workforce')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workforce')
export class WorkforceController {
  constructor(private readonly workforceService: WorkforceService) {}

  @Get()
  @RequirePermissions('workforce:read')
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<EmployeeRecord>> {
    return this.workforceService.list(user.tenantId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get(':id')
  @RequirePermissions('workforce:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<EmployeeRecord> {
    return this.workforceService.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('workforce:write')
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateEmployeeDto,
  ): Promise<EmployeeRecord> {
    return this.workforceService.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('workforce:write')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeRecord> {
    return this.workforceService.update(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions('workforce:write')
  archive(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<EmployeeRecord> {
    return this.workforceService.archive(user.tenantId, user.userId, id);
  }

  @Post(':id/restore')
  @RequirePermissions('workforce:write')
  restore(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<EmployeeRecord> {
    return this.workforceService.restore(user.tenantId, user.userId, id);
  }
}
