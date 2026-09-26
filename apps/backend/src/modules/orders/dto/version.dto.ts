import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

// A bare version envelope — reused by confirm and cancel, neither of which
// takes any other field (same pattern as Procurement's VersionDto; each
// bounded context owns its own copy rather than importing a sibling
// module's dto, Constitution I.3-I.4).
export class VersionDto {
  @ApiProperty({ description: 'The version last read by the caller — optimistic concurrency' })
  @IsInt()
  @Min(1)
  version!: number;
}
