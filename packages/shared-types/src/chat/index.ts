// Driver–owner chat (driver app V1, D9). Mirrors apps/backend/src/modules/chat/chat.entity.ts.
import type { IsoDateTime } from '../common';

export type ChatSide = 'driver' | 'office';

export interface ChatMessage {
  id: string;
  driverEmployeeId: string;
  side: ChatSide;
  senderName: string;
  body: string | null;
  tripId: string | null;
  tripNumber: string | null;
  /** none | pending (a photo message, the photo not here yet) | ready */
  photo: 'none' | 'pending' | 'ready';
  writtenAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export interface ChatThread {
  driver: { employeeId: string; name: string };
  messages: ChatMessage[];
  unread: number;
  readAt: IsoDateTime | null;
}

export interface ChatConversation {
  employeeId: string;
  name: string;
  phone: string | null;
  last: { side: ChatSide; body: string | null; photo: boolean; writtenAt: IsoDateTime } | null;
  unread: number;
  onTrip: { id: string; number: string } | null;
}
