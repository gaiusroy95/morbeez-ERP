import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersRepository } from './repositories/users.repository';
import { RolesRepository } from './repositories/roles.repository';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { PasswordService } from './security/password.service';
import { TokenService } from './security/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PinAuthService } from './pin-auth.service';
import { AlertsModule } from '../alerts/alerts.module';

// Bounded context: Users — identity, authentication, and access; not
// employment (Domain Model, Tier 00). Owns identity.app_user, role,
// permission, role_permission, user_role, and auth_session. A module that
// merely needs to know who's calling reads AuthContext (common/types) via
// JwtAuthGuard/PermissionsGuard in common/ — it never imports this module
// for that. TenantModule is the one deliberate exception: provisioning a
// business account's first user is genuinely Users' business logic
// (Constitution I.3), so Tenant imports this module and calls the two
// services below — never their repositories, entities, or anything else
// left unexported (Constitution I.4: through a public API, not by
// reaching into internals).
@Module({
  imports: [
    PassportModule,
    // Secret/expiry are set per-call in TokenService, not here — this
    // registration just makes JwtService injectable.
    JwtModule.register({}),
    // Raises the owner's security alert when a PIN is being guessed.
    AlertsModule,
  ],
  controllers: [UsersController, AuthController],
  providers: [
    UsersService,
    AuthService,
    UsersRepository,
    RolesRepository,
    AuthSessionsRepository,
    PasswordService,
    TokenService,
    JwtStrategy,
    PinAuthService,
  ],
  exports: [UsersService, AuthService],
})
export class UsersModule {}
