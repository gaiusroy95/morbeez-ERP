import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Thin wrapper so route handlers depend on this guard, not on the string
// literal 'jwt' scattered across every controller — and so a future
// concern (e.g. an @Public() escape hatch) has one place to live.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
