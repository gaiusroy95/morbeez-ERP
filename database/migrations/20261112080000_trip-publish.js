/* eslint-disable camelcase */

// The owner publishes a trip (Master Spec v3 §7.4–7.5, §58; P1): built and
// checked, then published — only then does its driver see it. The trip's
// status stays 'planned' until the driver starts it (everything that works on
// a planned trip keeps working); published_at says whether the driver may see
// it. Trips planned before this were visible as soon as they were made, so
// they count as published, by whoever made them.

exports.shorthands = undefined;

const TRIP = { schema: 'fulfilment', name: 'trip' };

exports.up = (pgm) => {
  pgm.addColumns(TRIP, {
    published_at: { type: 'timestamptz' },
    published_by: { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
  });
  pgm.sql('ALTER TABLE fulfilment.trip NO FORCE ROW LEVEL SECURITY');
  pgm.sql('UPDATE fulfilment.trip SET published_at = created_at, published_by = created_by');
  pgm.sql('ALTER TABLE fulfilment.trip FORCE ROW LEVEL SECURITY');
  pgm.addConstraint(TRIP, 'trip_published_together', { check: '(published_at IS NULL) = (published_by IS NULL)' });
};

exports.down = (pgm) => {
  pgm.dropConstraint(TRIP, 'trip_published_together');
  pgm.dropColumns(TRIP, ['published_at', 'published_by']);
};
