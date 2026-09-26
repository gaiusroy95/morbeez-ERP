import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ApprovalRequestStatus } from '../entities/approval.entity';

// Declared on the DTO, not as a separate @Query('status') — the global
// ValidationPipe forbids undeclared properties, so a bare param was
// rejected with "property status should not exist".
const STATUSES: readonly ApprovalRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export class ListApprovalRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, description: 'Only requests in this status' })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ApprovalRequestStatus;
}
