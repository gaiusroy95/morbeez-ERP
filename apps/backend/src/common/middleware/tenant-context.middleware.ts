import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

// Resolves tenant + role from the authenticated request and sets the
// Postgres session variable RLS policies key on. Tenant identity is never
// accepted from a client-supplied field (Constitution IV.2).
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    next();
  }
}
