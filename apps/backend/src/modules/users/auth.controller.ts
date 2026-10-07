import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService, TokenPair } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { PinAuthService } from './pin-auth.service';
import { PinLoginDto, RemovePinDto, SetPinDto } from './dto/pin.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly pins: PinAuthService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPair> {
    return this.authService.login(dto.login ?? dto.email ?? '', dto.password, userAgent, ip, dto.deviceId);
  }

  /** Signing in again on the driver's own phone with the PIN set there. */
  @Post('pin-login')
  @HttpCode(HttpStatus.OK)
  pinLogin(
    @Body() dto: PinLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPair> {
    return this.pins.pinLogin(dto.login, dto.deviceId, dto.pin, userAgent, ip);
  }

  /** Sets (or changes) the PIN for this phone; needs a signed-in session. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('pin')
  @HttpCode(HttpStatus.OK)
  setPin(@CurrentUser() user: AuthContext, @Body() dto: SetPinDto): Promise<{ deviceId: string }> {
    return this.pins.setPin(user.tenantId, user.userId, dto.deviceId, dto.pin);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('pin/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePin(@CurrentUser() user: AuthContext, @Body() dto: RemovePinDto): Promise<void> {
    return this.pins.removePin(user.tenantId, user.userId, dto.deviceId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPair> {
    return this.authService.refresh(dto.refreshToken, userAgent, ip);
  }

  // Requires a valid access token even though only the refresh token in
  // the body is actually revoked — otherwise anyone who merely intercepts
  // a refresh token (without ever having a valid access token) could log
  // another user out.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @CurrentUser() user: AuthContext,
    @Body() dto: RefreshTokenDto,
  ): Promise<void> {
    return this.authService.logout(user.tenantId, dto.refreshToken);
  }
}
