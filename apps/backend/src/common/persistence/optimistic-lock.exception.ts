import { ConflictException } from '@nestjs/common';

// Thrown when an UPDATE's `WHERE id = $1 AND version = $2` matches zero
// rows — someone else changed this record since the caller last read it
// (Production Database, Section 03 — optimistic concurrency versioning).
// A 409, not a silently-lost update.
export class OptimisticLockException extends ConflictException {
  constructor(entityType: string, id: string) {
    super(
      `${entityType} ${id} was modified by someone else since it was last read — reload and try again.`,
    );
  }
}
