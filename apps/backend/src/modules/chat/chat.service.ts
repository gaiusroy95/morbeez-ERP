import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../infra/database/database.service';
import { ObjectStorageService } from '../../infra/storage/object-storage.service';
import { WorkforceService } from '../workforce/workforce.service';
import { ChatRepository } from './chat.repository';
import { ChatConversation, ChatMessage, ChatSide, ChatThread } from './chat.entity';
import { SendMessageDto } from './chat.dto';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** A message as either app sees it — never where its photo is stored, or who sent it by id. */
function publicOf(m: ChatMessage & { senderUserId?: string; photoKey?: string | null; photoContentType?: string | null }): ChatMessage {
  const { senderUserId: _sender, photoKey: _key, photoContentType: _type, ...message } = m;
  return message;
}

export interface ChatPhotoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Driver–owner chat (driver app V1, D9; the client's answer 9): one
 * conversation per driver with the business. The driver reads and writes
 * their own; whoever plans trips reads and writes any driver's. A message
 * may be about one of the driver's trips and may carry a photo. Sent from a
 * phone that was offline, it arrives later with its own id and the time it
 * was written — once, however often it's sent. What's unread is counted
 * per reader, from when the server had each message.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: ObjectStorageService,
    private readonly workforce: WorkforceService,
    private readonly repo: ChatRepository,
  ) {}

  // ---- The driver's side ----

  private async driverOf(tenantId: string, userId: string): Promise<string> {
    const employeeId = await this.workforce.getEmployeeIdForUser(tenantId, userId);
    if (!employeeId) throw new ForbiddenException('Only a driver has a conversation of their own');
    return employeeId;
  }

  async myThread(tenantId: string, userId: string): Promise<ChatThread> {
    return this.thread(tenantId, userId, await this.driverOf(tenantId, userId), 'driver');
  }

  async sendMine(tenantId: string, userId: string, dto: SendMessageDto): Promise<ChatMessage> {
    return this.send(tenantId, userId, await this.driverOf(tenantId, userId), 'driver', dto);
  }

  async readMine(tenantId: string, userId: string, upTo?: string): Promise<{ readAt: Date }> {
    return this.markRead(tenantId, userId, await this.driverOf(tenantId, userId), upTo);
  }

  // ---- The office's side ----

  conversations(tenantId: string, userId: string): Promise<ChatConversation[]> {
    return this.db.withTenant(tenantId, (client) => this.repo.conversationsWithClient(client, userId));
  }

  async totalUnread(tenantId: string, userId: string): Promise<{ unread: number }> {
    return { unread: await this.db.withTenant(tenantId, (client) => this.repo.totalUnreadWithClient(client, userId)) };
  }

  officeThread(tenantId: string, userId: string, driverEmployeeId: string): Promise<ChatThread> {
    return this.thread(tenantId, userId, driverEmployeeId, 'office');
  }

  sendToDriver(tenantId: string, userId: string, driverEmployeeId: string, dto: SendMessageDto): Promise<ChatMessage> {
    return this.send(tenantId, userId, driverEmployeeId, 'office', dto);
  }

  async readDriver(tenantId: string, userId: string, driverEmployeeId: string, upTo?: string): Promise<{ readAt: Date }> {
    return this.markRead(tenantId, userId, driverEmployeeId, upTo);
  }

  // ---- Photos, either side ----

  /** The photo a message said would follow — once; only its sender sends it. */
  async attachPhoto(tenantId: string, userId: string, callerIsOffice: boolean, messageId: string, file: ChatPhotoFile): Promise<ChatMessage> {
    if (!PHOTO_TYPES.includes(file.mimetype)) throw new BadRequestException(`Unsupported image type: ${file.mimetype}`);
    const message = await this.reachable(tenantId, userId, callerIsOffice, messageId);
    if (message.senderUserId !== userId) throw new ForbiddenException('Only who sent the message sends its photo');
    if (message.photo === 'none') throw new ConflictException('This message has no photo to send');
    if (message.photo === 'ready') return publicOf(message);
    const extension = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const key = `${tenantId}/chat/${message.driverEmployeeId}/${messageId}-${randomUUID()}.${extension}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    return this.db.withTenant(tenantId, async (client) => {
      await this.repo.attachPhotoWithClient(client, messageId, key, file.mimetype);
      return publicOf((await this.repo.findWithClient(client, messageId))!);
    });
  }

  async photo(tenantId: string, userId: string, callerIsOffice: boolean, messageId: string): Promise<{ body: Buffer; contentType: string }> {
    const message = await this.reachable(tenantId, userId, callerIsOffice, messageId);
    if (!message.photoKey || !message.photoContentType) throw new NotFoundException('No photo yet');
    const body = await this.storage.get(message.photoKey);
    if (!body) throw new NotFoundException('No photo yet');
    return { body, contentType: message.photoContentType };
  }

  // ---- Shared ----

  /** A message the caller may see: the office any, a driver only their own conversation's. */
  private async reachable(tenantId: string, userId: string, callerIsOffice: boolean, messageId: string) {
    const message = await this.db.withTenant(tenantId, (client) => this.repo.findWithClient(client, messageId));
    if (!message) throw new NotFoundException('Message not found');
    if (!callerIsOffice && message.driverEmployeeId !== (await this.workforce.getEmployeeIdForUser(tenantId, userId))) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  private thread(tenantId: string, userId: string, driverEmployeeId: string, reader: ChatSide): Promise<ChatThread> {
    return this.db.withTenant(tenantId, async (client) => {
      const driver = await this.repo.employeeWithClient(client, driverEmployeeId);
      if (!driver) throw new NotFoundException('Driver not found');
      const { unread, readAt } = await this.repo.unreadWithClient(client, userId, driverEmployeeId, reader === 'driver' ? 'office' : 'driver');
      return { driver: { employeeId: driver.id, name: driver.name }, messages: await this.repo.messagesWithClient(client, driverEmployeeId), unread, readAt };
    });
  }

  private send(tenantId: string, userId: string, driverEmployeeId: string, side: ChatSide, dto: SendMessageDto): Promise<ChatMessage> {
    const body = dto.body?.trim() || null;
    if (!body && !dto.photo) throw new BadRequestException('Write something, or send a photo');
    return this.db.withTenant(tenantId, async (client) => {
      const existing = await this.repo.findWithClient(client, dto.id);
      if (existing) {
        // Sent again from a phone that wasn't sure it went: the same message.
        if (existing.senderUserId === userId && existing.driverEmployeeId === driverEmployeeId && existing.body === body) return publicOf(existing);
        throw new ConflictException('That message was sent already, differently');
      }
      if (!(await this.repo.employeeWithClient(client, driverEmployeeId))) throw new NotFoundException('Driver not found');
      if (dto.tripId) {
        const trip = await this.repo.tripWithClient(client, dto.tripId);
        if (!trip || trip.driverEmployeeId !== driverEmployeeId) throw new BadRequestException("That isn't one of this driver's trips");
      }
      const now = new Date();
      const written = dto.writtenAt ? new Date(dto.writtenAt) : now;
      await this.repo.insertWithClient(client, tenantId, {
        id: dto.id,
        driverEmployeeId,
        senderUserId: userId,
        side,
        body,
        tripId: dto.tripId ?? null,
        photo: dto.photo ?? false,
        // Never dated in the future by a phone clock ahead of time.
        writtenAt: written > now ? now : written,
      });
      // Writing is reading: what came before it on this side's screen.
      await this.repo.markReadWithClient(client, tenantId, userId, driverEmployeeId, now);
      return publicOf((await this.repo.findWithClient(client, dto.id))!);
    });
  }

  private markRead(tenantId: string, userId: string, driverEmployeeId: string, upTo?: string): Promise<{ readAt: Date }> {
    return this.db.withTenant(tenantId, async (client) => {
      if (!(await this.repo.employeeWithClient(client, driverEmployeeId))) throw new NotFoundException('Driver not found');
      const now = new Date();
      const at = upTo ? new Date(upTo) : now;
      return { readAt: await this.repo.markReadWithClient(client, tenantId, userId, driverEmployeeId, at > now ? now : at) };
    });
  }
}
