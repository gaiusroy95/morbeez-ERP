import { BadRequestException, ConflictException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The optional Idempotency-Key header (Constitution IV.3): a UUID the client
 * generates once per action and sends again on every retry of it.
 */
export function idempotencyKey(header: string | undefined): string | null {
  if (header === undefined || header === '') return null;
  if (!UUID.test(header)) throw new BadRequestException('Idempotency-Key must be a UUID');
  return header.toLowerCase();
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}

/**
 * Runs `write` at most once per key (Security Audit SA-03). A retry of the
 * same request gets the original result back; reusing a key for a
 * different request is refused rather than silently answered with the
 * wrong record. Two copies racing each other are settled by the unique
 * index on the key: the loser's transaction rolls back and it returns the
 * winner's row.
 */
export async function once<T>(opts: {
  key: string | null;
  constraint: string;
  find: () => Promise<T | null>;
  sameRequest: (prior: T) => boolean;
  write: () => Promise<T>;
}): Promise<T> {
  if (!opts.key) return opts.write();
  const replay = async (): Promise<T | null> => {
    const prior = await opts.find();
    if (prior && !opts.sameRequest(prior)) throw new ConflictException('This Idempotency-Key was already used for a different request');
    return prior;
  };
  const prior = await replay();
  if (prior) return prior;
  try {
    return await opts.write();
  } catch (err) {
    if (!isUniqueViolation(err, opts.constraint)) throw err;
    const winner = await replay();
    if (winner) return winner;
    throw new ConflictException('This Idempotency-Key was already used for a different request');
  }
}
