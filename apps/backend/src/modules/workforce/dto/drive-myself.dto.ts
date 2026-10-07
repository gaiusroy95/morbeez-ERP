import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DriveMyselfDto {
  @ApiProperty({ description: 'The name trips show for this driver' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}
