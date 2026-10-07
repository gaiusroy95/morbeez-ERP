import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { VALID_UOMS } from '../entities/product.entity';

export class UpdateProductDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: VALID_UOMS })
  @IsOptional()
  @IsIn(VALID_UOMS)
  baseUom?: string;

  @ApiPropertyOptional({ minimum: 0, nullable: true, description: 'A reference only: orders are priced from the last actual price' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basePrice?: number | null;

  @ApiPropertyOptional({ description: 'Eggs: pieces to a tray (default 30)' })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(1000)
  packSize?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Shrinkage or breakage accepted, %; null = the business default' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  lossTolerancePct?: number | null;
}
