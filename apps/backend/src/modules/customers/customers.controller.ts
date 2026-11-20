import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CustomersService, ShopPhotoFile } from './customers.service';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateCreditTermsDto } from './dto/update-credit-terms.dto';
import { CustomerRecord, CustomerTermsVersion } from './entities/customer.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CustomersBoardQueryDto } from './dto/customers-board.dto';
import { CustomerProfile, CustomersBoard } from './entities/customer-insights.entity';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions('customers:read')
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<CustomerRecord>> {
    return this.customersService.list(user.tenantId, query.page ?? 1, query.pageSize ?? 25);
  }

  /** The Customers list (redesign V1.1): filters, route, search; money for finance:read. */
  @Get('board')
  @RequirePermissions('customers:read')
  board(@CurrentUser() user: AuthContext, @Query() query: CustomersBoardQueryDto): Promise<CustomersBoard> {
    return this.customersService.board(
      user.tenantId,
      { filter: query.filter ?? 'all', routeId: query.routeId ?? null, q: query.q ?? null, page: query.page ?? 1, pageSize: query.pageSize ?? 100 },
      user.permissions.includes('finance:read'),
    );
  }

  /** Customer Profile: orders with orders:read, money with finance:read. */
  @Get(':id/profile')
  @RequirePermissions('customers:read')
  profile(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<CustomerProfile> {
    return this.customersService.profile(user.tenantId, id, {
      money: user.permissions.includes('finance:read'),
      orders: user.permissions.includes('orders:read'),
    });
  }

  @Get(':id')
  @RequirePermissions('customers:read')
  getById(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.getById(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('customers:write')
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateCustomerDto,
  ): Promise<CustomerRecord> {
    return this.customersService.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('customers:write')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<CustomerRecord> {
    return this.customersService.update(user.tenantId, user.userId, id, dto);
  }

  /** Every version of the customer's credit terms, newest first (Master Spec v3 P6, F6). */
  @Get(':id/terms-history')
  @RequirePermissions('customers:read')
  termsHistory(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<CustomerTermsVersion[]> {
    return this.customersService.termsHistory(user.tenantId, id);
  }

  @Post(':id/credit-terms')
  @RequirePermissions('customers:credit')
  updateCreditTerms(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCreditTermsDto,
  ): Promise<CustomerRecord> {
    return this.customersService.updateCreditTerms(user.tenantId, user.userId, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions('customers:write')
  archive(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.archive(user.tenantId, user.userId, id);
  }

  /** A new delivery QR for the shop (driver app D3). */
  @Post(':id/qr')
  @RequirePermissions('customers:write')
  newQr(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.newQr(user.tenantId, user.userId, id);
  }

  @Post(':id/restore')
  @RequirePermissions('customers:write')
  restore(@CurrentUser() user: AuthContext, @Param('id') id: string): Promise<CustomerRecord> {
    return this.customersService.restore(user.tenantId, user.userId, id);
  }

  /** The photo of the shop's front (customer onboarding); a new one replaces it. */
  @Post(':id/shop-photo')
  @RequirePermissions('customers:write')
  @ApiConsumes('multipart/form-data')
  // No `storage`/`dest`: multer keeps the upload in memory (file.buffer).
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  setShopPhoto(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: ShopPhotoFile,
  ): Promise<CustomerRecord> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.customersService.setShopPhoto(user.tenantId, user.userId, id, file);
  }

  /** The shop's photo itself. */
  @Get(':id/shop-photo')
  @RequirePermissions('customers:read')
  async shopPhoto(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const photo = await this.customersService.shopPhoto(user.tenantId, id);
    res.setHeader('content-type', photo.contentType);
    res.setHeader('cache-control', 'private, max-age=300');
    res.send(photo.body);
  }
}
