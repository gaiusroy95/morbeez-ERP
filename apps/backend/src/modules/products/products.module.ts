import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsRepository } from './repositories/products.repository';

// Bounded context: Products — the catalog: what, and in what units
// (Domain Model, Trading Partners & Catalog tier; Constitution II.2).
@Module({
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService],
})
export class ProductsModule {}
