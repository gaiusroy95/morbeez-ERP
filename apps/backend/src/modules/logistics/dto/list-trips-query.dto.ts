import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { TripStatus } from '../entities/trip.entity';

// Declared on the DTO, not as a separate @Query('status') — the global
// ValidationPipe forbids undeclared properties, so a bare param was
// rejected with "property status should not exist".
const STATUSES: readonly TripStatus[] = ['planned', 'in_progress', 'completed', 'cancelled', 'reconciled'];

export class ListTripsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, description: 'Only trips in this status' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: TripStatus;
}
