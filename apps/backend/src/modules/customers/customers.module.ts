import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

// Bounded context: Customers
// Owns its own schema (database/schemas/) and communicates with other
// modules only through published events or public APIs (Constitution I.3-I.4).
@Module({
  imports: [],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
