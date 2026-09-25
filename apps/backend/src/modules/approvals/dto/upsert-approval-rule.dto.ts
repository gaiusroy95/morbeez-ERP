import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpsertApprovalRuleDto {
  @ApiProperty({ description: "e.g. 'purchase_order', 'credit_note', 'bad_debt_writeoff', 'vehicle_disposal'" })
  @IsString()
  @MinLength(2)
  actionType!: string;

  @ApiProperty({ minimum: 0, description: '0 means every occurrence of this action type requires approval' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  thresholdAmount!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
