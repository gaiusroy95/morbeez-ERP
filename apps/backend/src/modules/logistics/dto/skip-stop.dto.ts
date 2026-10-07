import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SkipStopDto {
  @ApiPropertyOptional({ description: "Why it wasn't done: the customer refused, the farmer had nothing, …" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
