import { vehicleBoardOf } from './vehicle-board';

const vehicles = [
  { vehicle_id: 'v1', registration_number: 'KA-01-1234', trip_id: 't1', trip_number: 'T-20261028-001', driver_name: 'Raju' },
  { vehicle_id: 'v2', registration_number: 'KA-02-5678', trip_id: null, trip_number: null, driver_name: 'Suresh' },
];
const row = (vehicle_id: string, product: string, on_vehicle: string, reserved: string, to_deliver: string, uom = 'kg') => ({
  vehicle_id,
  product_id: `p-${product}`,
  product,
  uom,
  on_vehicle,
  reserved,
  to_deliver,
});

describe('vehicleBoardOf', () => {
  it('commits what the deliveries need — reserved or still to deliver, whichever is more, never more than aboard', () => {
    const board = vehicleBoardOf(vehicles, [
      row('v1', 'Ginger', '500.000', '100.000', '350.000'),
      row('v1', 'Turmeric', '300.000', '300.000', '0.000'),
      row('v1', 'Carrot', '0.000', '0.000', '50.000'),
      row('v2', 'Onion', '400.000', '0.000', '0.000'),
      row('v2', 'Eggs', '300.000', '0.000', '0.000', 'piece'),
    ]);
    const v1 = board.vehicles[0];
    expect(v1).toEqual(expect.objectContaining({ status: 'in_transit', tripNumber: 'T-20261028-001', driverName: 'Raju', totalKg: '800.000' }));
    expect(v1.products.map((p) => [p.product, p.committed, p.free])).toEqual([
      ['Ginger', '350.000', '150.000'],
      ['Turmeric', '300.000', '0.000'],
      ['Carrot', '0.000', '0.000'],
    ]);
    expect(board.vehicles[1]).toEqual(expect.objectContaining({ status: 'available', driverName: 'Suresh', totalKg: '400.000' }));
    // Pieces aren't kilos: eggs stay out of the kg totals.
    expect(board.totalsKg).toEqual({ onVehicles: '1200.000', committed: '650.000', free: '550.000' });
  });
});
