import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

// acceptedQuantity + rejectedQuantity must equal the lot's receivedQuantity
// — the service checks this before calling the repository, but
// commerce.lot's own lot_grading_reconciles CHECK is the real backstop
// (Constitution V.1). unitCost is required unless the whole lot is
// rejected, mirroring lot_unit_cost_set_iff_graded.
export class GradeLotDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  acceptedQuantity!: number;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  rejectedQuantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  grade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  rejectionReason?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Required unless the lot is fully rejected' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitCost?: number;
}
