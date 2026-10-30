/* eslint-disable camelcase */

// Driver app V1, Phase D6 — expenses on the road (docs/redesign/driver-app-v1-plan.md;
// client spec, design sheet "New Expense" / "My Expenses"):
//
// 1. The categories the driver chooses from: fuel, toll, parking, loading
//    (the existing 'labour'), repair, other.
// 2. A fuel expense carries the pump's details — odometer, fuel type, full
//    tank or not, litres and the rate — so the vehicle's mileage is worked
//    out from full tank to full tank, as for the owner's own fuel log.
// 3. fulfilment.trip_expense_photo: the bill, kept with the expense.
//    Insert-only.

exports.shorthands = undefined;

const EXPENSE = { schema: 'fulfilment', name: 'trip_expense' };
const PHOTO = { schema: 'fulfilment', name: 'trip_expense_photo' };

const OLD_CATEGORIES = ['fuel', 'toll', 'labour', 'other'];
const CATEGORIES = ['fuel', 'toll', 'parking', 'labour', 'repair', 'other'];
const FUEL_TYPES = ['diesel', 'petrol', 'cng', 'electric'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

exports.up = (pgm) => {
  pgm.dropConstraint(EXPENSE, 'trip_expense_category_valid');
  pgm.addConstraint(EXPENSE, 'trip_expense_category_valid', { check: `category IN (${list(CATEGORIES)})` });

  pgm.addColumns(EXPENSE, {
    odometer_km: { type: 'integer' },
    fuel_type: { type: 'text' },
    full_tank: { type: 'boolean' },
    litres: { type: 'numeric(10,3)' },
    rate_per_litre: { type: 'numeric(10,2)' },
  });
  // Only a fuel expense has a pump's details; litres and the rate come together.
  pgm.addConstraint(EXPENSE, 'trip_expense_fuel_details_valid', {
    check: `(category = 'fuel' OR (odometer_km IS NULL AND fuel_type IS NULL AND full_tank IS NULL AND litres IS NULL AND rate_per_litre IS NULL))
            AND (litres IS NULL) = (rate_per_litre IS NULL)
            AND (litres IS NULL OR (litres > 0 AND rate_per_litre > 0))
            AND (odometer_km IS NULL OR odometer_km >= 0)
            AND (fuel_type IS NULL OR fuel_type IN (${list(FUEL_TYPES)}))`,
  });
  pgm.createIndex(EXPENSE, ['trip_id', 'odometer_km'], { where: 'odometer_km IS NOT NULL' });

  pgm.createTable(PHOTO, {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'RESTRICT' },
    expense_id: { type: 'uuid', notNull: true, references: EXPENSE, onDelete: 'RESTRICT' },
    storage_key: { type: 'text', notNull: true },
    content_type: { type: 'text', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    uploaded_by: { type: 'uuid', notNull: true, references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(PHOTO, 'trip_expense_photo_valid', { check: 'size_bytes > 0' });
  pgm.createIndex(PHOTO, 'expense_id');
  pgm.sql('ALTER TABLE fulfilment.trip_expense_photo ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE fulfilment.trip_expense_photo FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY trip_expense_photo_tenant_isolation ON fulfilment.trip_expense_photo USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT ON fulfilment.trip_expense_photo TO morbeez_app');
  pgm.sql('REVOKE UPDATE, DELETE ON fulfilment.trip_expense_photo FROM morbeez_app');
};

exports.down = (pgm) => {
  pgm.dropTable(PHOTO);
  pgm.dropIndex(EXPENSE, ['trip_id', 'odometer_km']);
  pgm.dropConstraint(EXPENSE, 'trip_expense_fuel_details_valid');
  pgm.dropColumns(EXPENSE, ['odometer_km', 'fuel_type', 'full_tank', 'litres', 'rate_per_litre']);
  pgm.dropConstraint(EXPENSE, 'trip_expense_category_valid');
  pgm.addConstraint(EXPENSE, 'trip_expense_category_valid', { check: `category IN (${list(OLD_CATEGORIES)})` });
};
