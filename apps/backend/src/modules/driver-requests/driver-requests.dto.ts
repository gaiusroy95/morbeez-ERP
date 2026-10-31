import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { LANGUAGES } from '../../common/languages';
import { DriverRequestKind, DriverRequestStatus } from './driver-requests.entity';

const KINDS: DriverRequestKind[] = ['advance', 'new_customer', 'credit_limit'];

export class NewCustomerDetailsDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional({ description: 'Village or town' }) @IsOptional() @IsString() @MaxLength(120) place?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @ApiPropertyOptional({ enum: LANGUAGES }) @IsOptional() @IsIn(LANGUAGES) language?: string;
  @ApiPropertyOptional({ description: 'Where the shop is: the phone’s position when the driver asked' }) @IsOptional() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() longitude?: number;
}

export class CreateDriverRequestDto {
  @ApiPropertyOptional({ description: "The phone's own id: the same request sent again is the one recorded" })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ enum: KINDS }) @IsIn(KINDS) kind!: DriverRequestKind;

  @ApiPropertyOptional({ description: 'The trip the driver is on' }) @IsOptional() @IsUUID() tripId?: string;

  @ApiPropertyOptional({ description: 'An advance: how much. A credit limit: the limit asked for.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  amount?: number;

  @ApiPropertyOptional({ description: 'A credit limit: whose' }) @IsOptional() @IsUUID() customerId?: string;

  @ApiPropertyOptional({ type: NewCustomerDetailsDto, description: 'A new customer: who' })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewCustomerDetailsDto)
  customer?: NewCustomerDetailsDto;

  @ApiProperty({ description: 'Why — the owner reads it before deciding' }) @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class DecideDriverRequestDto {
  @ApiProperty() @IsBoolean() approve!: boolean;

  @ApiPropertyOptional({ description: 'Required to refuse: the driver reads it' }) @IsOptional() @IsString() @MaxLength(500) note?: string;

  @ApiPropertyOptional({ description: 'An advance: less than asked. A credit limit: a different limit.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  amount?: number;

  @ApiPropertyOptional({ enum: ['bank', 'cash_on_hand'], description: 'An advance: how it reaches the driver (default bank — a UPI transfer)' })
  @IsOptional()
  @IsIn(['bank', 'cash_on_hand'])
  paidFrom?: 'bank' | 'cash_on_hand';

  @ApiPropertyOptional({ type: NewCustomerDetailsDto, description: 'A new customer: the details as corrected by the owner' })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewCustomerDetailsDto)
  customer?: NewCustomerDetailsDto;

  @ApiPropertyOptional({ description: 'A new customer or a credit limit: days to pay' }) @IsOptional() @IsInt() @Min(0) @Max(180) paymentTermsDays?: number;
}

export class ListDriverRequestsQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'approved', 'rejected'] })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: DriverRequestStatus;
}
