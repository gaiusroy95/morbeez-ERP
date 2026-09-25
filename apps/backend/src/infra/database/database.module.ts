import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

// Global: every bounded-context module needs a database connection, and
// requiring each of the 14 to re-import this individually buys nothing
// (Constitution I.3's module boundaries are about business logic, not
// infrastructure wiring).
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
