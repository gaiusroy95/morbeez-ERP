import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthContext } from '../../common/types/auth-context';
import { ChatPhotoFile, ChatService } from './chat.service';
import { ReadUpToDto, SendMessageDto } from './chat.dto';
import { ChatConversation, ChatMessage, ChatThread } from './chat.entity';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Whoever plans trips speaks for the office. */
const isOffice = (user: AuthContext) => user.permissions.includes('logistics:dispatch');

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // ---- The driver's own conversation ----

  @Get('mine')
  @RequirePermissions('logistics:read')
  myThread(@CurrentUser() user: AuthContext): Promise<ChatThread> {
    return this.chat.myThread(user.tenantId, user.userId);
  }

  @Post('mine')
  @RequirePermissions('logistics:write')
  sendMine(@CurrentUser() user: AuthContext, @Body() dto: SendMessageDto): Promise<ChatMessage> {
    return this.chat.sendMine(user.tenantId, user.userId, dto);
  }

  @Post('mine/read')
  @HttpCode(200)
  @RequirePermissions('logistics:read')
  readMine(@CurrentUser() user: AuthContext, @Body() dto: ReadUpToDto): Promise<{ readAt: Date }> {
    return this.chat.readMine(user.tenantId, user.userId, dto.upTo);
  }

  // ---- The office: every driver's ----

  @Get('conversations')
  @RequirePermissions('logistics:dispatch')
  conversations(@CurrentUser() user: AuthContext): Promise<ChatConversation[]> {
    return this.chat.conversations(user.tenantId, user.userId);
  }

  /** What this owner hasn't read, across every driver (the menu's badge). */
  @Get('unread')
  @RequirePermissions('logistics:dispatch')
  unread(@CurrentUser() user: AuthContext): Promise<{ unread: number }> {
    return this.chat.totalUnread(user.tenantId, user.userId);
  }

  @Get('conversations/:employeeId')
  @RequirePermissions('logistics:dispatch')
  thread(@CurrentUser() user: AuthContext, @Param('employeeId', ParseUUIDPipe) employeeId: string): Promise<ChatThread> {
    return this.chat.officeThread(user.tenantId, user.userId, employeeId);
  }

  @Post('conversations/:employeeId')
  @RequirePermissions('logistics:dispatch')
  send(@CurrentUser() user: AuthContext, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: SendMessageDto): Promise<ChatMessage> {
    return this.chat.sendToDriver(user.tenantId, user.userId, employeeId, dto);
  }

  @Post('conversations/:employeeId/read')
  @HttpCode(200)
  @RequirePermissions('logistics:dispatch')
  read(@CurrentUser() user: AuthContext, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: ReadUpToDto): Promise<{ readAt: Date }> {
    return this.chat.readDriver(user.tenantId, user.userId, employeeId, dto.upTo);
  }

  // ---- Photos, either side ----

  @Post('messages/:id/photo')
  @RequirePermissions('logistics:write')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  attachPhoto(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: ChatPhotoFile): Promise<ChatMessage> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.chat.attachPhoto(user.tenantId, user.userId, isOffice(user), id, file);
  }

  /** The photo itself, to show in the conversation. */
  @Get('messages/:id/photo')
  @RequirePermissions('logistics:read')
  async photo(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const file = await this.chat.photo(user.tenantId, user.userId, isOffice(user), id);
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'private, max-age=86400');
    res.send(file.body);
  }
}
