import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { ApprovalsInboxRepository } from './repositories/approvals-inbox.repository';
import { ApprovalsInbox } from './entities/dashboard.entity';

/** The Approvals & Exceptions inbox (owner app redesign Phase 7): one list of everything waiting for the owner. */
@Injectable()
export class ApprovalsInboxService {
  constructor(
    private readonly db: DatabaseService,
    private readonly inbox: ApprovalsInboxRepository,
  ) {}

  getInbox(tenantId: string): Promise<ApprovalsInbox> {
    return this.db.withTenant(tenantId, (client) => this.inbox.inboxWithClient(client));
  }
}
