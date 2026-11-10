import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class RaiseDisputeDto {
  @ApiProperty()
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ description: 'How much of the invoice is disputed (₹)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '5 kg short on delivery' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class DisputeNoteDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  note!: string;
}

export class CloseDisputeDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: ['resolved', 'withdrawn'] })
  @IsIn(['resolved', 'withdrawn'])
  outcome!: 'resolved' | 'withdrawn';

  @ApiProperty({ description: 'What was agreed' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolution!: string;

  @ApiPropertyOptional({
    description:
      'How much of the disputed amount is accepted (₹) — credited by a credit note; the rest is owed and charged from the original due date. 0 or absent: rejected (MS §32).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  acceptedAmount?: number;
}

export class IssueCreditNoteDto {
  @ApiProperty()
  @IsUUID()
  invoiceId!: string;

  @ApiProperty({ description: 'How much less the customer owes (₹, GST included)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'Quality: 6 kg of tomato soft on arrival' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class WriteOffDto {
  @ApiProperty({ example: 'Shop closed; owner unreachable for 120 days' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class AdjustmentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}

export class ListDisputesQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'resolved', 'withdrawn'] })
  @IsOptional()
  @IsIn(['open', 'resolved', 'withdrawn'])
  status?: 'open' | 'resolved' | 'withdrawn';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}
