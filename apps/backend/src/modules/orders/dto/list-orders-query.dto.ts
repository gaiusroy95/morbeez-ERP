import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { OrderStatus } from '../entities/customer-order.entity';

// Declared on the DTO, not as a separate @Query('status') — the global
// ValidationPipe forbids undeclared properties, so a bare param was
// rejected with "property status should not exist".
const STATUSES: readonly OrderStatus[] = ['placed', 'confirmed', 'cancelled', 'delivered'];

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, description: 'Only orders in this status' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: OrderStatus;
}
