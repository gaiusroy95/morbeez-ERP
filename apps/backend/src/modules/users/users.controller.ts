import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { UsersService } from './users.service';
import { RegisterUserDto } from './dto/register-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { PreferencesDto } from './dto/preferences.dto';
import { PublicUser } from './entities/user.entity';

// User management within an already-authenticated tenant — creating the
// first user of a brand new tenant is Tenant-context provisioning, not
// this module's job, and isn't implemented here (Domain Model: Users
// conforms to Tenant, it doesn't create one).
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  list(@CurrentUser() user: AuthContext): Promise<PublicUser[]> {
    return this.usersService.list(user.tenantId);
  }

  @Post()
  @RequirePermissions('users:write')
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: RegisterUserDto,
  ): Promise<PublicUser> {
    return this.usersService.create(user.tenantId, { phone: dto.phone, email: dto.email ?? null }, dto.password);
  }

  @Post(':id/deactivate')
  @RequirePermissions('users:write')
  deactivate(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ): Promise<PublicUser> {
    return this.usersService.deactivate(user.tenantId, id);
  }

  @Post(':id/reactivate')
  @RequirePermissions('users:write')
  reactivate(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
  ): Promise<PublicUser> {
    return this.usersService.reactivate(user.tenantId, id);
  }

  @Post(':id/roles')
  @RequirePermissions('roles:assign')
  assignRole(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
  ): Promise<{ ok: true }> {
    return this.usersService
      .assignRole(user.tenantId, id, dto.roleId)
      .then(() => ({ ok: true as const }));
  }

  /** Your own settings: the language the apps speak to you in. Self-service. */
  @Get('me/preferences')
  preferences(@CurrentUser() user: AuthContext): Promise<{ language: string }> {
    return this.usersService.preferences(user.tenantId, user.userId);
  }

  @Patch('me/preferences')
  setPreferences(@CurrentUser() user: AuthContext, @Body() dto: PreferencesDto): Promise<{ language: string }> {
    return this.usersService.setPreferences(user.tenantId, user.userId, dto);
  }

  // Self-service: no permission required beyond being authenticated as
  // this user — changing your own password never needs users:write.
  @Post('me/change-password')
  changeOwnPassword(
    @CurrentUser() user: AuthContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.usersService.changePassword(
      user.tenantId,
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
