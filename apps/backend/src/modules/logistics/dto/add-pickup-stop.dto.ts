import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// sequenceNumber is optional — omit it to append at the end of the Route;
// supply it to insert at a specific position (the caller is responsible
// for leaving the numbering it expects; the database's own unique
// (trip_id, sequence_number) constraint is the actual backstop against a
// collision).
export class AddPickupStopDto {
  @ApiProperty({ description: 'An existing Procurement pickup — already scheduled with its purchase order and farmer' })
  @IsUUID()
  pickupId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  sequenceNumber?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
