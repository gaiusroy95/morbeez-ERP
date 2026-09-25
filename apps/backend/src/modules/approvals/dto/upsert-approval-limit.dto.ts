import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class UpsertApprovalLimitDto {
  @ApiProperty()
  @IsUUID()
  roleId!: string;

  @ApiPropertyOptional({ description: 'Omit for a wildcard limit applying to every action type' })
  @IsOptional()
  @IsString()
  actionType?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Omit for an unlimited approval limit' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxAmount?: number;
}
