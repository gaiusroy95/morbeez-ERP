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

// Bounded context: Users — identity, authentication, and access; not
// employment (Domain Model, Tier 00). Owns identity.app_user, role,
// permission, role_permission, user_role, and auth_session. Other modules
// depend on this one only through AuthContext (common/types) and the
// JwtAuthGuard/PermissionsGuard in common/ — never by importing anything
// from modules/users directly (Constitution I.3-I.4).
@Module({
  imports: [
    PassportModule,
    // Secret/expiry are set per-call in TokenService, not here — this
    // registration just makes JwtService injectable.
    JwtModule.register({}),
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
  ],
  exports: [UsersService],
})
export class UsersModule {}
