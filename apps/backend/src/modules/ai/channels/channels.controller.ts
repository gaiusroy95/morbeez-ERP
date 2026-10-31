import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthContext } from '../../../common/types/auth-context';
import { IntegrationsService, IntegrationsStatus } from './integrations.service';
import { WhatsAppService } from './whatsapp.service';
import { VoiceService } from './voice.service';
import { InboundMessage, VoiceCall } from './channels.repository';
import { IntegrationSettingsDto, PlaceCallDto } from './channels.dto';

const actor = (u: AuthContext) => ({ tenantId: u.tenantId, userId: u.userId, permissions: u.permissions });

// The owner's side of the AI's channels: what's set up (ai:read), the
// business's choices (tenant:manage), the WhatsApp messages received and the
// calls placed (ai:read with customers:read — they name customers). Reading
// a message again or placing a call is ai:decide:customers, checked in the
// services, like deciding an order suggestion.
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class ChannelsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly whatsapp: WhatsAppService,
    private readonly voice: VoiceService,
  ) {}

  @Get('integrations')
  @RequirePermissions('ai:read')
  status(@CurrentUser() user: AuthContext): Promise<IntegrationsStatus> {
    return this.integrations.status(user.tenantId);
  }

  @Put('integrations/settings')
  @RequirePermissions('tenant:manage')
  save(@CurrentUser() user: AuthContext, @Body() dto: IntegrationSettingsDto): Promise<IntegrationsStatus> {
    return this.integrations.saveSettings(user.tenantId, user.userId, {
      version: dto.version,
      whatsappPhoneNumberId: dto.whatsappPhoneNumberId ?? null,
      whatsappReply: dto.whatsappReply,
      callsEnabled: dto.callsEnabled,
    });
  }

  @Get('ai/whatsapp/messages')
  @RequirePermissions('ai:read', 'customers:read')
  messages(@CurrentUser() user: AuthContext): Promise<InboundMessage[]> {
    return this.whatsapp.messages(user.tenantId);
  }

  @Post('ai/whatsapp/messages/:id/read-again')
  @HttpCode(200)
  @RequirePermissions('ai:read', 'customers:read')
  readAgain(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<InboundMessage> {
    return this.whatsapp.readAgain(actor(user), id);
  }

  @Get('ai/calls/voice')
  @RequirePermissions('ai:read', 'customers:read')
  calls(@CurrentUser() user: AuthContext): Promise<VoiceCall[]> {
    return this.voice.history(user.tenantId);
  }

  @Post('ai/calls/voice/preview')
  @HttpCode(200)
  @RequirePermissions('ai:read', 'customers:read')
  preview(@CurrentUser() user: AuthContext, @Body() dto: PlaceCallDto) {
    return this.voice.preview(actor(user), dto);
  }

  @Post('ai/calls/voice')
  @RequirePermissions('ai:read', 'customers:read')
  place(@CurrentUser() user: AuthContext, @Body() dto: PlaceCallDto): Promise<VoiceCall> {
    return this.voice.place(actor(user), dto);
  }
}
