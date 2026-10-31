import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Matches, Min, ValidateIf } from 'class-validator';
import { CallPurpose } from './voice-script';

const PURPOSES: CallPurpose[] = ['payment_reminder', 'order_reminder', 'order_confirm'];

export class IntegrationSettingsDto {
  @ApiProperty({ description: '0 when saving for the first time' }) @IsInt() @Min(0) version!: number;

  @ApiPropertyOptional({ nullable: true, description: "Meta's id for the business's WhatsApp number (WhatsApp Manager → API setup → Phone number ID)" })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^\d{5,30}$/, { message: 'The phone number ID is the long number Meta shows, digits only' })
  whatsappPhoneNumberId?: string | null;

  @ApiProperty({ description: 'Answer each order message with what was understood' }) @IsBoolean() whatsappReply!: boolean;
  @ApiProperty({ description: 'Let automated calls be placed to customers from AI Calling' }) @IsBoolean() callsEnabled!: boolean;
}

export class PlaceCallDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty({ enum: PURPOSES }) @IsIn(PURPOSES) purpose!: CallPurpose;
  @ApiPropertyOptional({ description: "An order call: the AI Calling row's suggestion" }) @IsOptional() @IsUUID() recommendationId?: string;
}
