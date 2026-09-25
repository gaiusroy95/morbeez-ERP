import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

// The integration point future modules call through (Procurement for a
// large purchase order, Finance for a credit note) — subjectId is that
// module's own record id, opaque to this framework.
export class CreateApprovalRequestDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  actionType!: string;

  @ApiProperty()
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Omit for a non-monetary action' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;
}
