import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class SyncFailureDto {
  @ApiProperty({ description: 'What the action was, e.g. START_TRIP' }) @IsString() @Length(1, 40) type!: string;
  @ApiProperty({ description: "The server's words for the refusal" }) @IsString() @MaxLength(500) error!: string;
  @ApiProperty({ description: 'When it was recorded on the phone' }) @IsISO8601() at!: string;
}

/** What a phone's offline queue holds after a sync pass (owner Phase 8). */
export class SyncReportDto {
  @ApiProperty() @IsString() @Length(1, 100) deviceId!: string;
  @ApiProperty({ enum: ['android', 'ios', 'web'] }) @IsIn(['android', 'ios', 'web']) platform!: 'android' | 'ios' | 'web';
  @ApiProperty() @IsString() @Length(1, 40) appVersion!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(100_000) pendingOperations!: number;
  @ApiProperty({ description: 'Of the pending, those the server refused' }) @IsInt() @Min(0) @Max(100_000) failedOperations!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100_000) pendingPhotos!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100_000) failedPhotos!: number;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() oldestPendingAt?: string;
  @ApiProperty({ type: [SyncFailureDto] }) @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SyncFailureDto) failures!: SyncFailureDto[];
  @ApiProperty({ enum: ['success', 'partial'] }) @IsIn(['success', 'partial']) lastResult!: 'success' | 'partial';
  @ApiProperty({ description: 'When the pass ran, on the phone' }) @IsISO8601() syncedAt!: string;
}
