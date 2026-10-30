// Driver–owner chat (driver app V1, D9): one conversation per driver with
// the business; any message may be about one of their trips, and may carry
// a photo. Mirrored in packages/shared-types/src/chat.

export type ChatSide = 'driver' | 'office';

export interface ChatMessage {
  id: string;
  driverEmployeeId: string;
  side: ChatSide;
  /** Who wrote it: the driver's name, or the owner's (else their login). */
  senderName: string;
  body: string | null;
  tripId: string | null;
  tripNumber: string | null;
  /** none | pending (a photo message, the photo not here yet) | ready */
  photo: 'none' | 'pending' | 'ready';
  /** When it was written on the phone or in the app. */
  writtenAt: Date;
  /** When the server had it: what "unread" counts from. */
  createdAt: Date;
}

/** A driver's conversation, as one side reads it. */
export interface ChatThread {
  driver: { employeeId: string; name: string };
  messages: ChatMessage[];
  /** Messages from the other side the reader hasn't read. */
  unread: number;
  /** How far the reader has read. */
  readAt: Date | null;
}

/** The owner's list: every driver, the last word, what's unread. */
export interface ChatConversation {
  employeeId: string;
  name: string;
  phone: string | null;
  last: { side: ChatSide; body: string | null; photo: boolean; writtenAt: Date } | null;
  unread: number;
  /** The trip they're on now, if any. */
  onTrip: { id: string; number: string } | null;
}
