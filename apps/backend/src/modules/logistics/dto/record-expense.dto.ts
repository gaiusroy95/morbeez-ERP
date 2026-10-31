import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ExpenseCategory, ExpensePaidBy, FuelType } from '../entities/trip-expense.entity';

const VALID_CATEGORIES: ExpenseCategory[] = ['fuel', 'toll', 'parking', 'labour', 'repair', 'other'];
const FUEL_TYPES: FuelType[] = ['diesel', 'petrol', 'cng', 'electric'];

export class RecordExpenseDto {
  @ApiPropertyOptional({ description: "The phone's own id for it, so its bill photo can follow it (driver app D6)" })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ enum: VALID_CATEGORIES })
  @IsIn(VALID_CATEGORIES)
  category!: ExpenseCategory;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // ---- A fuel expense's pump details (D6) ----

  @ApiPropertyOptional({ description: 'Fuel: the odometer at the pump' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerKm?: number;

  @ApiPropertyOptional({ enum: FUEL_TYPES })
  @IsOptional()
  @IsIn(FUEL_TYPES)
  fuelType?: FuelType;

  @ApiPropertyOptional({ description: 'Fuel: filled to the brim — mileage runs from one full tank to the next' })
  @IsOptional()
  @IsBoolean()
  fullTank?: boolean;

  @ApiPropertyOptional({ description: 'Fuel: litres filled, with the rate' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(10_000)
  litres?: number;

  @ApiPropertyOptional({ description: 'Fuel: rate per litre, with the litres' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000)
  ratePerLitre?: number;

  @ApiPropertyOptional({ enum: ['cash', 'fastag'], default: 'cash', description: "A toll or parking taken off the vehicle's FASTag rather than paid from the driver's cash" })
  @IsOptional()
  @IsIn(['cash', 'fastag'])
  paidBy?: ExpensePaidBy;
}

/** The owner's decision on an expense beyond the driver's authority (Approvals inbox). */
export class DecideExpenseDto {
  @ApiProperty()
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional({ description: 'Required to reject: why' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** A bill photo for an expense (multipart field next to the file). */
export class UploadExpensePhotoDto {
  @ApiPropertyOptional({ enum: ['bill'] })
  @IsOptional()
  @IsIn(['bill'])
  photoType?: 'bill';
}
