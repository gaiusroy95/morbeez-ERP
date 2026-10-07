import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { LANGUAGES } from '../../../common/languages';

export class PreferencesDto {
  @ApiProperty({ enum: LANGUAGES, description: 'en, ml (Malayalam), kn (Kannada), ta (Tamil)' })
  @IsIn(LANGUAGES)
  language!: string;
}
