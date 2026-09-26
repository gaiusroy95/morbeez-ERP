import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

// signatureData is optional — a 'pod'-type photo already uploaded for this
// stop can satisfy proof on its own; LogisticsService requires at least
// one of the two, not both. recipientName is always required: a delivery
// completed with no record of who received it isn't proof of anything.
export class CompleteDeliveryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  recipientName!: string;

  @ApiPropertyOptional({ description: 'Base64-encoded signature image data' })
  @IsOptional()
  @IsString()
  signatureData?: string;
}
