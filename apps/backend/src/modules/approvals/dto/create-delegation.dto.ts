import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsUUID } from 'class-validator';

// No delegatorUserId field — a caller can only ever delegate a role they
// hold themselves, read from the authenticated context
// (Constitution IV.2's pattern, applied here instead of tenantId).
export class CreateDelegationDto {
  @ApiProperty()
  @IsUUID()
  roleId!: string;

  @ApiProperty()
  @IsUUID()
  delegateUserId!: string;

  @ApiProperty()
  @IsDateString()
  startsAt!: string;

  @ApiProperty()
  @IsDateString()
  endsAt!: string;
}
