import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ObjectStorageService } from '../../infra/storage/object-storage.service';
import { Env } from '../../config/env.validation';
import { normalizeIndianMobile } from '../../common/phone';
import { UsersService } from '../users/users.service';
import { EmployeesRepository } from './repositories/employees.repository';
import { PayrollRepository } from './repositories/payroll.repository';
import { PayrollService } from './payroll.service';
import { NEW_DRIVER_LEVEL } from './workforce.service';
import { WorkerDetail, WorkerDocument, WorkerDocumentKind } from './entities/payroll.entity';

export const DOCUMENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface UploadedDocument {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/** A link the owner sends a worker, to choose their own password. */
export interface LoginLink {
  link: string;
  expiresAt: string;
  /** The number they sign in with. */
  login: string;
  /** A login was created just now (false: a new link for an existing login). */
  created: boolean;
}

/**
 * Adding a worker with their details, keeping their documents, and giving
 * them a login by link (client feedback, Oct 2026). Logins are for drivers
 * for now: what other staff roles may see is the owner's decision still to
 * be made.
 */
@Injectable()
export class WorkerAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly employees: EmployeesRepository,
    private readonly repo: PayrollRepository,
    private readonly payroll: PayrollService,
    private readonly users: UsersService,
    private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** One step: the worker, their phone and address. Employment details and pay come after, as before. */
  async addWorker(
    tenantId: string,
    actorUserId: string,
    dto: { name: string; roleType: string; phone?: string | null; address?: string | null },
  ): Promise<WorkerDetail> {
    const id = await this.db.withTenant(tenantId, async (client) => {
      const employee = await this.employees.createWithClient(client, tenantId, actorUserId, {
        name: dto.name.trim(),
        roleType: dto.roleType,
        employmentTerms: {},
        ...(dto.roleType === 'driver' ? { delegationLevel: NEW_DRIVER_LEVEL, standingDelegation: true } : {}),
      });
      await this.repo.saveProfile(client, tenantId, employee.id, actorUserId, 0, {
        employmentType: 'permanent',
        skillCategory: 'unskilled',
        workStateCode: null,
        joinedOn: null,
        leftOn: null,
        phone: clean(dto.phone),
        address: clean(dto.address),
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'employee',
        entityId: employee.id,
        after: { ...employee, phone: clean(dto.phone), address: clean(dto.address) } as unknown as Record<string, unknown>,
      });
      return employee.id;
    });
    return this.payroll.getWorker(tenantId, id);
  }

  // ---- Documents ----

  async addDocument(
    tenantId: string,
    actorUserId: string,
    employeeId: string,
    kind: WorkerDocumentKind,
    label: string | null,
    file: UploadedDocument,
  ): Promise<WorkerDocument> {
    const extension = DOCUMENT_TYPES[file.mimetype];
    if (!extension) throw new BadRequestException('Attach a photo (JPG, PNG, WebP) or a PDF.');
    const key = `${tenantId}/workers/${employeeId}/${randomUUID()}.${extension}`;
    // Checked before the file is stored, so a wrong worker leaves nothing behind.
    await this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.employeeExists(client, employeeId))) throw new NotFoundException('Worker not found');
    });
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.db.withTenant(tenantId, async (client) => {
      const r = await client.query<{ id: string }>(
        `INSERT INTO workforce.worker_document
           (tenant_id, employee_id, kind, label, storage_key, content_type, size_bytes, file_name, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [tenantId, employeeId, kind, clean(label), key, file.mimetype, file.size, clean(file.originalname?.slice(0, 200)), actorUserId],
      );
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: 'worker_document',
        entityId: r.rows[0].id,
        after: { employeeId, kind, label: clean(label), contentType: file.mimetype, sizeBytes: file.size },
      });
      const docs = await this.repo.documents(client, employeeId);
      return docs.find((d) => d.id === r.rows[0].id)!;
    });
  }

  /** The file, for viewing. */
  async documentFile(tenantId: string, employeeId: string, documentId: string): Promise<{ body: Buffer; contentType: string; fileName: string | null }> {
    const doc = await this.db.withTenant(tenantId, async (client) => {
      const r = await client.query<{ storage_key: string; content_type: string; file_name: string | null }>(
        'SELECT storage_key, content_type, file_name FROM workforce.worker_document WHERE id = $1 AND employee_id = $2 AND removed_at IS NULL',
        [documentId, employeeId],
      );
      return r.rows[0];
    });
    if (!doc) throw new NotFoundException('Document not found');
    const body = await this.storage.get(doc.storage_key);
    if (!body) throw new NotFoundException('The file is no longer stored. Attach it again.');
    return { body, contentType: doc.content_type, fileName: doc.file_name };
  }

  /** Removes it from the worker; the record of it (who, when) stays. */
  async removeDocument(tenantId: string, actorUserId: string, employeeId: string, documentId: string): Promise<WorkerDetail> {
    await this.db.withTenant(tenantId, async (client) => {
      const r = await client.query(
        `UPDATE workforce.worker_document SET removed_at = now(), removed_by = $3
         WHERE id = $1 AND employee_id = $2 AND removed_at IS NULL`,
        [documentId, employeeId, actorUserId],
      );
      if (!r.rowCount) throw new NotFoundException('Document not found');
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: 'worker_document',
        entityId: documentId,
        before: { removed: false },
        after: { removed: true },
      });
    });
    return this.payroll.getWorker(tenantId, employeeId);
  }

  // ---- Login ----

  /**
   * A password set-up link for the worker. Without a login yet, one is made
   * for the given mobile number (or the one on their profile) and linked to
   * them; with one, this is a fresh link — the "forgot my password" path.
   */
  async loginLink(tenantId: string, actorUserId: string, employeeId: string, phone?: string | null): Promise<LoginLink> {
    const result = await this.db.withTenant(tenantId, async (client) => {
      const r = await client.query<{ user_id: string | null; role_type: string; status: string; profile_phone: string | null }>(
        `SELECT e.user_id, e.role_type, e.status, p.phone AS profile_phone
         FROM trading_partners.employee e LEFT JOIN workforce.worker_profile p ON p.employee_id = e.id WHERE e.id = $1`,
        [employeeId],
      );
      const worker = r.rows[0];
      if (!worker) throw new NotFoundException('Worker not found');
      if (worker.status !== 'active') throw new ConflictException('This worker is archived. Restore them first.');

      let userId = worker.user_id;
      let created = false;
      if (!userId) {
        if (worker.role_type !== 'driver') {
          throw new BadRequestException('App logins are for drivers for now. Other staff roles are coming.');
        }
        const normalized = normalizeIndianMobile(phone ?? worker.profile_phone ?? '');
        if (!normalized) throw new BadRequestException('Enter their 10-digit mobile number: it is what they sign in with.');
        const user = await this.users.provisionStaffLoginWithClient(client, tenantId, normalized, 'Driver');
        await client.query('UPDATE trading_partners.employee SET user_id = $2, version = version + 1, updated_at = now() WHERE id = $1', [
          employeeId,
          user.id,
        ]);
        if (!worker.profile_phone) {
          await client.query('UPDATE workforce.worker_profile SET phone = $2 WHERE employee_id = $1', [employeeId, normalized]);
        }
        userId = user.id;
        created = true;
      }
      const login = await this.repo.loginOf(client, employeeId);
      const { token, expiresAt } = await this.users.issuePasswordSetupWithClient(client, tenantId, userId, actorUserId);
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: created ? 'create' : 'update',
        entityType: 'staff_login',
        entityId: employeeId,
        after: { login, linkSent: true, expiresAt: expiresAt.toISOString() },
      });
      return { token, expiresAt, login: login ?? '', created };
    });
    return {
      link: `${this.appUrl()}/set-password?token=${result.token}`,
      expiresAt: result.expiresAt.toISOString(),
      login: result.login,
      created: result.created,
    };
  }

  private appUrl(): string {
    const configured = this.config.get('PUBLIC_APP_URL', { infer: true });
    const first = configured ?? this.config.get('CORS_ORIGIN', { infer: true }).split(',')[0].trim();
    return first.replace(/\/+$/, '');
  }
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}
