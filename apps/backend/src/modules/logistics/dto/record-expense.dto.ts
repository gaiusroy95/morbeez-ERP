import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { ExpenseCategory } from '../entities/trip-expense.entity';

const VALID_CATEGORIES: ExpenseCategory[] = ['fuel', 'toll', 'labour', 'other'];

export class RecordExpenseDto {
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
  notes?: string;
}
