import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { DelegationsController } from './delegations.controller';
import { ApprovalsService } from './approvals.service';
import { DelegationsService } from './delegations.service';
import { ApprovalRulesRepository } from './repositories/approval-rules.repository';
import { ApprovalLimitsRepository } from './repositories/approval-limits.repository';
import { ApprovalRequestsRepository } from './repositories/approval-requests.repository';
import { ApprovalDelegationsRepository } from './repositories/approval-delegations.repository';
import { UsersModule } from '../users/users.module';

// A deliberate extension to the Domain Model — no "Approvals" bounded
// context existed there. Cross-cutting: rules, limits, requests, and
// delegation apply across whichever future contexts (Procurement,
// Finance, Vehicles) need a sign-off gate, not to one context alone.
// Imports UsersModule for role resolution (UsersService.getRoleIdsForUserWithClient)
// — through its public API, never RolesRepository directly
// (Constitution I.3-I.4).
@Module({
  imports: [UsersModule],
  controllers: [ApprovalsController, DelegationsController],
  providers: [
    ApprovalsService,
    DelegationsService,
    ApprovalRulesRepository,
    ApprovalLimitsRepository,
    ApprovalRequestsRepository,
    ApprovalDelegationsRepository,
  ],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
