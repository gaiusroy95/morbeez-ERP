import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PhotoType } from '../entities/trip-stop-photo.entity';

const VALID_PHOTO_TYPES: PhotoType[] = ['pickup', 'delivery', 'pod', 'issue'];

// The file itself travels as multipart form data (field name "file"); this
// DTO only covers the accompanying text field.
export class UploadPhotoDto {
  @ApiProperty({ enum: VALID_PHOTO_TYPES })
  @IsIn(VALID_PHOTO_TYPES)
  photoType!: PhotoType;
}
