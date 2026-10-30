import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { BackhaulService } from './backhaul.service';
import { UploadedPhoto } from './logistics.service';
import { BackhaulPhotoRecord, BackhaulRecord } from './entities/backhaul.entity';
import { BackhaulPaymentDto, BackhaulStepDto, CancelBackhaulDto, CreateBackhaulDto, SkipBackhaulDto, UploadBackhaulPhotoDto } from './dto/backhaul.dto';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const isDispatcher = (user: AuthContext) => user.permissions.includes('logistics:dispatch');

/**
 * A trip's backhauls (driver app D5): the owner offers (logistics:dispatch)
 * and may cancel; the trip's own driver adds, accepts or skips, runs and
 * records the payment (logistics:write, their own trip only).
 */
@ApiTags('logistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('logistics/trips/:id/backhauls')
export class BackhaulController {
  constructor(private readonly backhauls: BackhaulService) {}

  @Get()
  @RequirePermissions('logistics:read')
  list(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) tripId: string): Promise<BackhaulRecord[]> {
    return this.backhauls.list(user.tenantId, user.userId, isDispatcher(user), tripId);
  }

  @Post()
  @RequirePermissions('logistics:write')
  create(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) tripId: string, @Body() dto: CreateBackhaulDto): Promise<BackhaulRecord> {
    return this.backhauls.create(user.tenantId, user.userId, isDispatcher(user), tripId, dto);
  }

  @Post(':backhaulId/accept')
  @RequirePermissions('logistics:write')
  accept(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('backhaulId', ParseUUIDPipe) backhaulId: string,
  ): Promise<BackhaulRecord> {
    return this.backhauls.accept(user.tenantId, user.userId, isDispatcher(user), tripId, backhaulId);
  }

  @Post(':backhaulId/skip')
  @RequirePermissions('logistics:write')
  skip(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('backhaulId', ParseUUIDPipe) backhaulId: string,
    @Body() dto: SkipBackhaulDto,
  ): Promise<BackhaulRecord> {
    return this.backhauls.skip(user.tenantId, user.userId, isDispatcher(user), tripId, backhaulId, dto);
  }

  @Post(':backhaulId/cancel')
  @RequirePermissions('logistics:dispatch')
  cancel(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('backhaulId', ParseUUIDPipe) backhaulId: string,
    @Body() dto: CancelBackhaulDto,
  ): Promise<BackhaulRecord> {
    return this.backhauls.cancel(user.tenantId, user.userId, tripId, backhaulId, dto ?? {});
  }

  /** Pickup reached, loaded, drop reached, completed — in that order. */
  @Post(':backhaulId/steps')
  @RequirePermissions('logistics:write')
  step(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('backhaulId', ParseUUIDPipe) backhaulId: string,
    @Body() dto: BackhaulStepDto,
  ): Promise<BackhaulRecord> {
    return this.backhauls.step(user.tenantId, user.userId, isDispatcher(user), tripId, backhaulId, dto);
  }

  @Post(':backhaulId/payment')
  @RequirePermissions('logistics:write')
  pay(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('backhaulId', ParseUUIDPipe) backhaulId: string,
    @Body() dto: BackhaulPaymentDto,
  ): Promise<BackhaulRecord> {
    return this.backhauls.pay(user.tenantId, user.userId, isDispatcher(user), tripId, backhaulId, dto);
  }

  @Post(':backhaulId/photos')
  @RequirePermissions('logistics:write')
  @ApiConsumes('multipart/form-data')
  // No `storage`/`dest`: multer keeps the upload in memory (file.buffer).
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  uploadPhoto(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) tripId: string,
    @Param('backhaulId', ParseUUIDPipe) backhaulId: string,
    @Body() dto: UploadBackhaulPhotoDto,
    @UploadedFile() file?: UploadedPhoto,
  ): Promise<BackhaulPhotoRecord> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.backhauls.addPhoto(user.tenantId, user.userId, isDispatcher(user), tripId, backhaulId, dto.photoType, file);
  }
}
