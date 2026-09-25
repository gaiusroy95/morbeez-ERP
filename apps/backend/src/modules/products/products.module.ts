import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

// Bounded context: Products
// Owns its own schema (database/schemas/) and communicates with other
// modules only through published events or public APIs (Constitution I.3-I.4).
@Module({
  imports: [],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
