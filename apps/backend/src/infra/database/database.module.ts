import { Module } from '@nestjs/common';

// PostgreSQL connection (Amazon RDS). Per-context schemas (System
// Architecture, DB.3); Row-Level Security enforced at the database level
// (Constitution III.1).
@Module({})
export class DatabaseModule {}
