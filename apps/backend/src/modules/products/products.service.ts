import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../infra/database/database.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ProductsRepository } from './repositories/products.repository';
import { ProductKind, ProductRecord } from './entities/product.entity';
import { PaginatedResult } from '../../common/persistence/pagination';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const ENTITY_TYPE = 'product';
/** A tray of eggs, unless the owner says otherwise. */
const DEFAULT_TRAY = 30;

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsRepository,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, page: number, pageSize: number): Promise<PaginatedResult<ProductRecord>> {
    return this.products.list(tenantId, page, pageSize);
  }

  async getById(tenantId: string, id: string): Promise<ProductRecord> {
    const product = await this.products.findById(tenantId, id);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  create(tenantId: string, actorUserId: string, dto: CreateProductDto): Promise<ProductRecord> {
    const kind = (dto.kind ?? 'standard') as ProductKind;
    // Live birds are weighed (kg); eggs are counted (pieces, by the tray or one by one).
    const baseUom = kind === 'live_bird' ? 'kg' : kind === 'egg' ? 'piece' : dto.baseUom;
    if (kind !== 'egg' && dto.packSize !== undefined) throw new BadRequestException('Only eggs come in trays');
    return this.db.withTenant(tenantId, async (client) => {
      const product = await this.products.createWithClient(client, tenantId, actorUserId, {
        name: dto.name,
        category: dto.category,
        baseUom,
        basePrice: dto.basePrice ?? null,
        kind,
        packSize: kind === 'egg' ? dto.packSize ?? DEFAULT_TRAY : null,
        lossTolerancePct: dto.lossTolerancePct ?? null,
      });
      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'create',
        entityType: ENTITY_TYPE,
        entityId: product.id,
        after: product as unknown as Record<string, unknown>,
      });
      return product;
    });
  }

  update(
    tenantId: string,
    actorUserId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.products.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Product not found');

      if (dto.baseUom !== undefined && before.kind !== 'standard' && dto.baseUom !== before.baseUom) {
        throw new BadRequestException(before.kind === 'egg' ? 'Eggs are counted in pieces' : 'Live birds are sold by kg');
      }
      if (dto.packSize !== undefined && before.kind !== 'egg') throw new BadRequestException('Only eggs come in trays');
      const after = await this.products.updateWithClient(client, id, dto.version, {
        name: dto.name,
        category: dto.category,
        baseUom: dto.baseUom,
        basePrice: dto.basePrice,
        packSize: dto.packSize,
        lossTolerancePct: dto.lossTolerancePct,
      });

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action: 'update',
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }

  archive(tenantId: string, actorUserId: string, id: string): Promise<ProductRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'archived', 'archive');
  }

  restore(tenantId: string, actorUserId: string, id: string): Promise<ProductRecord> {
    return this.setStatus(tenantId, actorUserId, id, 'active', 'restore');
  }

  private setStatus(
    tenantId: string,
    actorUserId: string,
    id: string,
    status: 'active' | 'archived',
    action: 'archive' | 'restore',
  ): Promise<ProductRecord> {
    return this.db.withTenant(tenantId, async (client) => {
      const before = await this.products.findByIdWithClient(client, id);
      if (!before) throw new NotFoundException('Product not found');

      const after = await this.products.setStatusWithClient(client, id, status);
      if (!after) throw new NotFoundException('Product not found');

      await this.audit.record(client, {
        tenantId,
        actorUserId,
        action,
        entityType: ENTITY_TYPE,
        entityId: id,
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
      });
      return after;
    });
  }
}
