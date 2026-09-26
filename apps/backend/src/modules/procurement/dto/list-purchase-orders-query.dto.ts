import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PurchaseOrderStatus } from '../entities/purchase-order.entity';

// Declared on the DTO, not as a separate @Query('status') — the global
// ValidationPipe forbids undeclared properties, so a bare param was
// rejected with "property status should not exist".
const STATUSES: readonly PurchaseOrderStatus[] = ['placed', 'confirmed', 'cancelled', 'received', 'graded', 'closed'];

export class ListPurchaseOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, description: 'Only purchase orders in this status' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: PurchaseOrderStatus;
}
