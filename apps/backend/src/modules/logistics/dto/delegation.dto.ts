import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class SetEligibilityDto {
  @ApiProperty({ nullable: true, description: 'Highest level this driver may be delegated (1–4); null: not eligible' })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(4)
  delegationLevel!: number | null;

  @ApiProperty({ description: 'Standing permission: authorized at that level on every trip, without per-trip approval' })
  @IsBoolean()
  standingDelegation!: boolean;
}

export class GrantDelegationDto {
  @ApiProperty()
  @IsUUID()
  driverEmployeeId!: string;

  @ApiProperty({ minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  level!: number;

  @ApiProperty({ enum: ['trip', 'temporary'], description: "Day-off grants come from day-off mode" })
  @IsIn(['trip', 'temporary'])
  kind!: 'trip' | 'temporary';

  @ApiPropertyOptional({ description: 'The trip (kind = trip); a planned trip is handed to this driver' })
  @ValidateIf((o) => o.kind === 'trip')
  @IsUUID()
  tripId?: string;

  @ApiPropertyOptional({ description: 'When it ends (kind = temporary)' })
  @ValidateIf((o) => o.kind === 'temporary')
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StartDayOffDto {
  @ApiProperty({ description: 'The backup driver who runs the day' })
  @IsUUID()
  driverEmployeeId!: string;

  @ApiProperty({ minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  level!: number;

  @ApiPropertyOptional({ type: [String], description: 'Planned trips handed to that driver' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  tripIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
