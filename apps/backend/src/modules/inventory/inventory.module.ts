import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LocationsRepository } from './repositories/locations.repository';
import { InventoryMovementsRepository } from './repositories/inventory-movements.repository';
import { VehicleBoardRepository } from './repositories/vehicle-board.repository';
import { ProductsModule } from '../products/products.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { FinanceModule } from '../finance/finance.module';

// Bounded context: Inventory — locations, stock summaries (physical /
// reserved / available), shrinkage, post-acceptance rejection, and
// transfers between locations. Owns stock.location and
// stock.inventory_movement; commerce.lot itself stays Procurement's
// (imported here for its public service API only — LotStockService and
// the recordShrinkage/recordRejectionPostAcceptance/transferLot/
// listLotsForProduct/getLot methods on ProcurementService, Constitution
// I.3-I.4). The owner's Vehicle Stock is a read-only view across stock,
// trips and orders (VehicleBoardRepository).
@Module({
  imports: [ProductsModule, VehiclesModule, ProcurementModule, FinanceModule],
  controllers: [InventoryController],
  providers: [InventoryService, LocationsRepository, InventoryMovementsRepository, VehicleBoardRepository],
  exports: [InventoryService],
})
export class InventoryModule {}
