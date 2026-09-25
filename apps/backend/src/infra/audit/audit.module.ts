import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Global for the same reason DatabaseModule is: every bounded context that
// mutates master data needs this, and re-importing it per-module buys
// nothing (Constitution I.3's boundaries are about business logic, not
// this kind of infrastructure wiring).
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
