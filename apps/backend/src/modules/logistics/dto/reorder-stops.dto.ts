import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsUUID, Min } from 'class-validator';

export class ReorderStopsDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ description: "Every one of the trip's stops, in the new order" })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  stopIds!: string[];
}
