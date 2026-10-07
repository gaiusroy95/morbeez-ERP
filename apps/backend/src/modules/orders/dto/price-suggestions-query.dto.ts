import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class PriceSuggestionsQueryDto {
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  /** Comma-separated, or repeated. */
  @ApiProperty({ type: [String] })
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value).split(',').filter(Boolean)))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  productIds!: string[];
}
