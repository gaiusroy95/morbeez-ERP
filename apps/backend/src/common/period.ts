import { BadRequestException } from '@nestjs/common';

// Rejects shapes the PeriodQueryDto regex lets through but that aren't real
// dates (2026-02-31), which would otherwise surface as a Postgres cast error.
export function assertRealDate(value: string, field: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} is not a real calendar date`);
  }
}

export function daysInclusive(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}
