/* eslint-disable camelcase */

// Driver app V1, Phase D2 — the farmer stop (docs/redesign/driver-app-v1-plan.md;
// client spec §5–§8, the client's answers 1 and 4):
//
// 1. fulfilment.farm_stop_line: what happened to each product at a farm
//    stop. Accepted — weighed (or counted in bags of a set weight), packed in
//    sacks, loaded; the kilos become a lot at the owner's rate on the
//    vehicle (ProcurementService.acceptAtFarm). Rejected — with the reason
//    (quality issue, quantity short, damaged, farmer not ready, other) and a
//    note; nothing is owed for it. Insert-only: the driver edits lines on the
//    phone until hold-to-complete, and what's sent then is final.
// 2. The stop's packing crew: a packer and a loader from the business's own
//    workers (the same person may do both). Each is credited in payroll with
//    the kilos loaded there (workforce.assignment, kind 'loading').
// 3. Photo types 'load' (the goods loaded) and 'rejection' (why a product
//    was refused); a photo can name the product it shows.

exports.shorthands = undefined;

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };
const employeeColumn = { type: 'uuid', references: { schema: 'trading_partners', name: 'employee' }, onDelete: 'RESTRICT' };
const productColumn = { type: 'uuid', references: { schema: 'trading_partners', name: 'product' }, onDelete: 'RESTRICT' };

const LINE = { schema: 'fulfilment', name: 'farm_stop_line' };
const STOP = { schema: 'fulfilment', name: 'trip_stop' };
const PHOTO = { schema: 'fulfilment', name: 'trip_stop_photo' };

const REASONS = ['quality_issue', 'quantity_short', 'damaged', 'farmer_not_ready', 'other'];
const OLD_PHOTO_TYPES = ['pickup', 'delivery', 'pod', 'issue', 'weighment'];
const PHOTO_TYPES = [...OLD_PHOTO_TYPES, 'load', 'rejection'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

exports.up = (pgm) => {
  pgm.createTable(LINE, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: tenantColumn,
    trip_stop_id: { type: 'uuid', notNull: true, references: STOP, onDelete: 'RESTRICT' },
    product_id: { ...productColumn, notNull: true },
    outcome: { type: 'text', notNull: true },
    accepted_quantity: { type: 'numeric(12,3)', notNull: true, default: 0 },
    // Weighed and refused at the farm (it stays there); 0 when nothing was weighed.
    rejected_quantity: { type: 'numeric(12,3)', notNull: true, default: 0 },
    // 'weight': the scale's net figure; 'bags': sacks × kg a bag.
    measured_by: { type: 'text', notNull: true, default: 'weight' },
    sacks: { type: 'integer' },
    kg_per_bag: { type: 'numeric(10,3)' },
    reason: { type: 'text' },
    note: { type: 'text' },
    lot_id: { type: 'uuid', references: { schema: 'commerce', name: 'lot' }, onDelete: 'RESTRICT' },
    recorded_by: { ...userColumn, notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(LINE, 'farm_stop_line_valid', {
    check: `outcome IN ('accepted', 'rejected')
            AND measured_by IN ('weight', 'bags')
            AND accepted_quantity >= 0 AND rejected_quantity >= 0
            AND (sacks IS NULL OR sacks >= 0)
            AND (kg_per_bag IS NULL OR kg_per_bag > 0)
            AND (measured_by = 'weight' OR (sacks > 0 AND kg_per_bag IS NOT NULL))
            AND (reason IS NULL OR reason IN (${list(REASONS)}))
            AND CASE outcome
                  WHEN 'accepted' THEN accepted_quantity > 0 AND reason IS NULL
                  ELSE accepted_quantity = 0 AND reason IS NOT NULL AND lot_id IS NULL
                END`,
  });
  pgm.addConstraint(LINE, 'farm_stop_line_once', { unique: ['trip_stop_id', 'product_id'] });
  pgm.createIndex(LINE, ['tenant_id', 'trip_stop_id']);
  pgm.sql('ALTER TABLE fulfilment.farm_stop_line ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.farm_stop_line FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY farm_stop_line_tenant_isolation ON fulfilment.farm_stop_line USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT ON fulfilment.farm_stop_line TO morbeez_app');
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.farm_stop_line FROM morbeez_app');

  pgm.addColumns(STOP, {
    packer_employee_id: employeeColumn,
    loader_employee_id: employeeColumn,
  });
  pgm.addConstraint(STOP, 'trip_stop_crew_on_pickup', {
    check: `stop_type = 'pickup' OR (packer_employee_id IS NULL AND loader_employee_id IS NULL)`,
  });

  pgm.addColumns(PHOTO, { product_id: productColumn });
  pgm.dropConstraint(PHOTO, 'trip_stop_photo_type_valid');
  pgm.addConstraint(PHOTO, 'trip_stop_photo_type_valid', { check: `photo_type IN (${list(PHOTO_TYPES)})` });
};

exports.down = (pgm) => {
  pgm.dropConstraint(PHOTO, 'trip_stop_photo_type_valid');
  pgm.sql('ALTER TABLE fulfilment.trip_stop_photo NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`DELETE FROM fulfilment.trip_stop_photo WHERE photo_type NOT IN (${list(OLD_PHOTO_TYPES)})`);
  pgm.sql('ALTER TABLE fulfilment.trip_stop_photo FORCE ROW LEVEL SECURITY');
  pgm.addConstraint(PHOTO, 'trip_stop_photo_type_valid', { check: `photo_type IN (${list(OLD_PHOTO_TYPES)})` });
  pgm.dropColumns(PHOTO, ['product_id']);
  pgm.dropConstraint(STOP, 'trip_stop_crew_on_pickup');
  pgm.dropColumns(STOP, ['packer_employee_id', 'loader_employee_id']);
  pgm.dropTable(LINE);
};
