import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResult } from '../../common/persistence/pagination';
import { FarmersService } from './farmers.service';
import { CreateFarmerDto } from './dto/create-farmer.dto';
import { UpdateFarmerDto } from './dto/update-farmer.dto';
import { FarmerRecord } from './entities/farmer.entity';

@ApiTags('farmers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('farmers')
export class FarmersController {
  constructor(private readonly farmersService: FarmersService) {}

  @Get()
  @RequirePermissions('farmers:read')
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<FarmerRecord>> {
    return this.farmersService.list(user.tenantId, query.page ?? 1, query.pageSize ?? 25);
  }

  @Get(':id')
  @RequirePermissions('farmers:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<FarmerRecord> {
    return this.farmersService.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('farmers:write')
  create(@CurrentUser() user: AuthContext, @Body() dto: CreateFarmerDto): Promise<FarmerRecord> {
    return this.farmersService.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('farmers:write')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateFarmerDto,
  ): Promise<FarmerRecord> {
    return this.farmersService.update(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions('farmers:write')
  archive(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<FarmerRecord> {
    return this.farmersService.archive(user.tenantId, user.userId, id);
  }

  @Post(':id/restore')
  @RequirePermissions('farmers:write')
  restore(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<FarmerRecord> {
    return this.farmersService.restore(user.tenantId, user.userId, id);
  }
}
