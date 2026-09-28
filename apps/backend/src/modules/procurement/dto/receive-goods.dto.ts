import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsNumber, IsOptional, IsPositive, IsUUID, ValidateNested } from 'class-validator';

export class ReceivedLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  receivedQuantity!: number;
}

// One Lot is created per line — Goods Received (Event Catalog) — not
// linked to a version, since it doesn't mutate the purchase order's own
// row, only transitions its status (placed/confirmed -> received), which
// the service checks against the PO's current state directly.
export class ReceiveGoodsDto {
  @ApiProperty({ type: [ReceivedLineDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivedLineDto)
  lines!: ReceivedLineDto[];

  // Validators are required, not decorative: the global ValidationPipe runs
  // with forbidNonWhitelisted, so an undecorated property is rejected.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  pickupId?: string;
}
