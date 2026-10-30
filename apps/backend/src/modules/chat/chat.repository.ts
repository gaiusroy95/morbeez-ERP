import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ChatConversation, ChatMessage, ChatSide } from './chat.entity';

/**
 * Who wrote it: their worker record — else, an owner with none, the
 * business's name (a driver reads "Dev Wholesaler Co.", never a login).
 * Its own aliases, so it reads the caller's columns.
 */
const SENDER_OF = (user: string, tenant: string) => `
  COALESCE((SELECT nm_e.name FROM trading_partners.employee nm_e WHERE nm_e.user_id = ${user} ORDER BY nm_e.created_at LIMIT 1),
           (SELECT nm_t.name FROM tenant.tenant nm_t WHERE nm_t.id = ${tenant}))`;

const MESSAGE_SELECT = `
  SELECT m.id, m.driver_employee_id, m.side, ${SENDER_OF('m.sender_user_id', 'm.tenant_id')} AS sender_name, m.body, m.trip_id, t.number AS trip_number,
         m.photo_expected, m.photo_key, m.written_at, m.created_at
  FROM chat.message m LEFT JOIN fulfilment.trip t ON t.id = m.trip_id`;

const toMessage = (r: Record<string, unknown>): ChatMessage => ({
  id: r.id as string,
  driverEmployeeId: r.driver_employee_id as string,
  side: r.side as ChatSide,
  senderName: r.sender_name as string,
  body: r.body as string | null,
  tripId: r.trip_id as string | null,
  tripNumber: r.trip_number as string | null,
  photo: r.photo_key ? 'ready' : r.photo_expected ? 'pending' : 'none',
  writtenAt: r.written_at as Date,
  createdAt: r.created_at as Date,
});

/**
 * The other side's messages after the reader's mark — what's unread to them.
 * To the millisecond: the apps read up to a message's createdAt as JSON
 * carries it, without the database's microseconds.
 */
const UNREAD = (reader: string, driver: string, otherSide: string) => `
  (SELECT count(*)::int FROM chat.message u
   WHERE u.driver_employee_id = ${driver} AND u.side = ${otherSide}
     AND date_trunc('milliseconds', u.created_at) > COALESCE((SELECT rm.read_at FROM chat.read_marker rm WHERE rm.user_id = ${reader} AND rm.driver_employee_id = ${driver}), '-infinity'))`;

/** Driver–owner chat (driver app D9): RLS scopes every statement to the tenant. */
@Injectable()
export class ChatRepository {
  /** A conversation's latest messages, oldest first, in the order they were written. */
  async messagesWithClient(client: PoolClient, driverEmployeeId: string, limit = 200): Promise<ChatMessage[]> {
    const r = await client.query(
      `SELECT * FROM (${MESSAGE_SELECT} WHERE m.driver_employee_id = $1 ORDER BY m.created_at DESC LIMIT $2) x ORDER BY x.written_at, x.created_at`,
      [driverEmployeeId, limit],
    );
    return r.rows.map(toMessage);
  }

  async findWithClient(client: PoolClient, id: string): Promise<(ChatMessage & { senderUserId: string; photoKey: string | null; photoContentType: string | null }) | null> {
    const r = await client.query(
      `SELECT x.*, mm.sender_user_id, mm.photo_content_type FROM (${MESSAGE_SELECT} WHERE m.id = $1) x JOIN chat.message mm ON mm.id = x.id`,
      [id],
    );
    const row = r.rows[0];
    return row ? { ...toMessage(row), senderUserId: row.sender_user_id, photoKey: row.photo_key, photoContentType: row.photo_content_type } : null;
  }

  /** Written once: the same id again changes nothing (false). */
  async insertWithClient(
    client: PoolClient,
    tenantId: string,
    m: { id: string; driverEmployeeId: string; senderUserId: string; side: ChatSide; body: string | null; tripId: string | null; photo: boolean; writtenAt: Date },
  ): Promise<boolean> {
    const r = await client.query(
      `INSERT INTO chat.message (id, tenant_id, driver_employee_id, sender_user_id, side, body, trip_id, photo_expected, written_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [m.id, tenantId, m.driverEmployeeId, m.senderUserId, m.side, m.body, m.tripId, m.photo, m.writtenAt],
    );
    return (r.rowCount ?? 0) === 1;
  }

  /** The photo, attached once to the message that expects it. */
  async attachPhotoWithClient(client: PoolClient, id: string, key: string, contentType: string): Promise<boolean> {
    const r = await client.query(
      'UPDATE chat.message SET photo_key = $2, photo_content_type = $3 WHERE id = $1 AND photo_expected AND photo_key IS NULL',
      [id, key, contentType],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async unreadWithClient(client: PoolClient, userId: string, driverEmployeeId: string, otherSide: ChatSide): Promise<{ unread: number; readAt: Date | null }> {
    const r = await client.query<{ unread: number; read_at: Date | null }>(
      `SELECT ${UNREAD('$1', '$2', '$3')} AS unread,
              (SELECT read_at FROM chat.read_marker WHERE user_id = $1 AND driver_employee_id = $2) AS read_at`,
      [userId, driverEmployeeId, otherSide],
    );
    return { unread: r.rows[0].unread, readAt: r.rows[0].read_at };
  }

  /** Read up to [upTo] — never back. */
  async markReadWithClient(client: PoolClient, tenantId: string, userId: string, driverEmployeeId: string, upTo: Date): Promise<Date> {
    const r = await client.query<{ read_at: Date }>(
      `INSERT INTO chat.read_marker (tenant_id, user_id, driver_employee_id, read_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, driver_employee_id) DO UPDATE SET read_at = GREATEST(chat.read_marker.read_at, EXCLUDED.read_at)
       RETURNING read_at`,
      [tenantId, userId, driverEmployeeId, upTo],
    );
    return r.rows[0].read_at;
  }

  /** Every driver (active, or with messages): the last word, what this owner hasn't read, the trip they're on. */
  async conversationsWithClient(client: PoolClient, userId: string): Promise<ChatConversation[]> {
    const r = await client.query(
      `SELECT e.id, e.name, wp.phone,
              last.side AS last_side, last.body AS last_body, last.photo_expected AS last_photo, last.written_at AS last_at,
              ${UNREAD('$1', 'e.id', "'driver'")} AS unread,
              trip.id AS trip_id, trip.number AS trip_number
       FROM trading_partners.employee e
       LEFT JOIN workforce.worker_profile wp ON wp.employee_id = e.id
       LEFT JOIN LATERAL (SELECT m.side, m.body, m.photo_expected, m.written_at FROM chat.message m WHERE m.driver_employee_id = e.id
                          ORDER BY m.created_at DESC LIMIT 1) last ON true
       LEFT JOIN LATERAL (SELECT t.id, t.number FROM fulfilment.trip t WHERE t.driver_employee_id = e.id AND t.status = 'in_progress'
                          ORDER BY t.started_at DESC NULLS LAST LIMIT 1) trip ON true
       WHERE (e.role_type = 'driver' AND e.status = 'active') OR last.side IS NOT NULL
       ORDER BY last.written_at DESC NULLS LAST, e.name`,
      [userId],
    );
    return r.rows.map((x) => ({
      employeeId: x.id,
      name: x.name,
      phone: x.phone,
      last: x.last_side ? { side: x.last_side, body: x.last_body, photo: x.last_photo, writtenAt: x.last_at } : null,
      unread: x.unread,
      onTrip: x.trip_id ? { id: x.trip_id, number: x.trip_number } : null,
    }));
  }

  /** What this owner hasn't read across every driver: the menu's badge. */
  async totalUnreadWithClient(client: PoolClient, userId: string): Promise<number> {
    const r = await client.query<{ n: number }>(
      `SELECT COALESCE(SUM(${UNREAD('$1', 'd.id', "'driver'")}), 0)::int AS n
       FROM (SELECT DISTINCT driver_employee_id AS id FROM chat.message) d`,
      [userId],
    );
    return r.rows[0].n;
  }

  /** A trip's driver and number, to check a message is about one of theirs. */
  async tripWithClient(client: PoolClient, tripId: string): Promise<{ driverEmployeeId: string; number: string } | null> {
    const r = await client.query<{ driver_employee_id: string; number: string }>('SELECT driver_employee_id, number FROM fulfilment.trip WHERE id = $1', [tripId]);
    return r.rows[0] ? { driverEmployeeId: r.rows[0].driver_employee_id, number: r.rows[0].number } : null;
  }

  async employeeWithClient(client: PoolClient, employeeId: string): Promise<{ id: string; name: string } | null> {
    const r = await client.query<{ id: string; name: string }>('SELECT id, name FROM trading_partners.employee WHERE id = $1', [employeeId]);
    return r.rows[0] ?? null;
  }
}
