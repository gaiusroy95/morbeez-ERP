import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { FarmersBoardQueryDto } from './dto/farmers-board.dto';
import { FarmerProfile, FarmersBoard } from './entities/farmer-insights.entity';

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

  /** The Farmers list (redesign V1.1): filters, by village or town, search; money for finance:read. */
  @Get('board')
  @RequirePermissions('farmers:read')
  board(@CurrentUser() user: AuthContext, @Query() query: FarmersBoardQueryDto): Promise<FarmersBoard> {
    return this.farmersService.board(
      user.tenantId,
      { filter: query.filter ?? 'all', place: query.place ?? null, q: query.q ?? null, page: query.page ?? 1, pageSize: query.pageSize ?? 100 },
      user.permissions.includes('finance:read'),
    );
  }

  /** Farmer profile: purchases with procurement:read, money with finance:read. */
  @Get(':id/profile')
  @RequirePermissions('farmers:read')
  profile(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<FarmerProfile> {
    return this.farmersService.profile(user.tenantId, id, {
      money: user.permissions.includes('finance:read'),
      purchases: user.permissions.includes('procurement:read'),
    });
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
