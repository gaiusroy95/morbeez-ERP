import { Body, Controller, ForbiddenException, Get, Ip, Patch, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.validation';
import { RateLimiterService } from '../../infra/rate-limit/rate-limiter.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantAccess, TenantRecord } from './entities/tenant.entity';
import { AuthService, TokenPair } from '../users/auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';

@ApiTags('tenant')
@Controller('tenants')
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly authService: AuthService,
    private readonly limiter: RateLimiterService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // The one unauthenticated write in the whole API — there is, by
  // definition, no auth context yet for a business that doesn't exist.
  // Returns tokens immediately (signup implies login) so the client
  // doesn't need a second round trip through /auth/login.
  //
  // Limited per IP (Security Audit SA-02): without it anyone could create
  // businesses without end, and probe which numbers already have a login.
  // Every business made here starts on a free trial (TRIAL_DAYS).
  @Post()
  async signUp(@Body() dto: CreateTenantDto, @Ip() ip: string): Promise<TokenPair> {
    await this.limiter.consume(`signup-ip:${ip}`, { max: 10, windowSeconds: 60 * 60 }, 'Too many new accounts from this network.');
    if (!this.config.get('SIGNUP_ENABLED', { infer: true })) {
      throw new ForbiddenException('New businesses are set up by the Morbeez team for now. Contact us to join.');
    }
    await this.tenantService.createBusinessAccount(
      dto.businessName.trim(),
      { phone: dto.ownerPhone, email: dto.ownerEmail ?? null },
      dto.ownerPassword,
    );
    return this.authService.login(dto.ownerPhone, dto.ownerPassword, undefined, ip);
  }

  // User-to-business relationship, made concrete: the tenant returned is
  // always the caller's own — read from the verified JWT
  // (Constitution IV.2), never from a route param, so there is no
  // `/tenants/:id` a signed-in user from Tenant A could point at Tenant B.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMine(@CurrentUser() user: AuthContext): Promise<TenantRecord> {
    return this.tenantService.getById(user.tenantId);
  }

  // The free trial and subscription, for the apps to say how many days
  // are left or that the business is read-only. Every signed-in user of
  // the business may see it: staff hit the same read-only wall.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me/access')
  getMyAccess(@CurrentUser() user: AuthContext): Promise<TenantAccess> {
    return this.tenantService.access(user.tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('tenant:manage')
  @Patch('me')
  updateMine(
    @CurrentUser() user: AuthContext,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantRecord> {
    return this.tenantService.update(user.tenantId, dto);
  }
}
