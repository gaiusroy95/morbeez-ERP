import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthContext } from '../types/auth-context';

// @CurrentUser() in a controller method signature — the only sanctioned
// way to read who's calling and which tenant they belong to
// (Constitution IV.2: never re-derived from a request body/query param).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
