import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LocationsRepository } from './repositories/locations.repository';
import { InventoryMovementsRepository } from './repositories/inventory-movements.repository';
import { ProductsModule } from '../products/products.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { ProcurementModule } from '../procurement/procurement.module';

// Bounded context: Inventory — locations, stock summaries (physical /
// reserved / available), shrinkage, post-acceptance rejection, and
// transfers between locations. Owns stock.location and
// stock.inventory_movement; commerce.lot itself stays Procurement's
// (imported here for its public service API only — reserveLotsForOrderLine
// and friends already established that pattern for Orders, and the new
// recordShrinkage/recordRejectionPostAcceptance/transferLot/listLotsForProduct/
// getLot methods on ProcurementService are this module's equivalent,
// Constitution I.3-I.4).
@Module({
  imports: [ProductsModule, VehiclesModule, ProcurementModule],
  controllers: [InventoryController],
  providers: [InventoryService, LocationsRepository, InventoryMovementsRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
