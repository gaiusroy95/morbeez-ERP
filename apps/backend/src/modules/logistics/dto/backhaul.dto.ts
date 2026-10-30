import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, MinLength } from 'class-validator';
import { BackhaulPaymentMethod, BackhaulPhotoType, BackhaulStep } from '../entities/backhaul.entity';

const STEPS: BackhaulStep[] = ['pickup_reached', 'loaded', 'drop_reached', 'completed'];
const METHODS: BackhaulPaymentMethod[] = ['cash', 'upi', 'bank_transfer'];
const PHOTO_TYPES: BackhaulPhotoType[] = ['load', 'drop', 'payment'];

/** A backhaul: the owner's offer, or one the driver took on the road (driver app D5). */
export class CreateBackhaulDto {
  @ApiPropertyOptional({ description: "The phone's own id for a backhaul added offline: the same id again is the same backhaul" })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  pickupPlace!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  dropPlace!: string;

  @ApiProperty({ description: 'The fixed rent for the job' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  rent!: number;

  @ApiPropertyOptional({ description: 'Who hired the vehicle' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  hirerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SkipBackhaulDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class CancelBackhaulDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class BackhaulStepDto {
  @ApiProperty({ enum: STEPS })
  @IsIn(STEPS)
  step!: BackhaulStep;

  @ApiPropertyOptional({ description: 'When it happened on the phone (sent later when offline); never later than now' })
  @IsOptional()
  @IsDateString()
  at?: string;
}

export class BackhaulPaymentDto {
  @ApiProperty({ enum: METHODS })
  @IsIn(METHODS)
  method!: BackhaulPaymentMethod;

  @ApiProperty({ description: 'What was received: no more than the rent' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ description: 'UPI or transfer: its reference (UTR)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiPropertyOptional({ description: 'When it was paid on the phone; never later than now' })
  @IsOptional()
  @IsDateString()
  at?: string;
}

// The file travels as multipart form data (field "file").
export class UploadBackhaulPhotoDto {
  @ApiProperty({ enum: PHOTO_TYPES })
  @IsIn(PHOTO_TYPES)
  photoType!: BackhaulPhotoType;
}
