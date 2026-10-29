import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class HomeQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month'], default: 'today' })
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';
}
