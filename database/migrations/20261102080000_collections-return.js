/* eslint-disable camelcase */

// Driver app V1, Phase D4 — collections, return, handover
// (docs/redesign/driver-app-v1-plan.md; client spec §18–§23):
//
// 1. A collection says who paid — the customer, or someone else on their
//    behalf (paid by) — and, for UPI or a transfer, its reference (UTR).
//    Its proof is a 'payment' photo on the delivery stop.
// 2. Return: the closing KM when the vehicle is back (never below the
//    opening KM) and when; trip KM = closing − opening.

exports.shorthands = undefined;

const TRIP = { schema: 'fulfilment', name: 'trip' };
const COLLECTION = { schema: 'money', name: 'customer_collection' };
const PHOTO = { schema: 'fulfilment', name: 'trip_stop_photo' };

const OLD_PHOTO_TYPES = ['pickup', 'delivery', 'pod', 'issue', 'weighment', 'load', 'rejection'];
const PHOTO_TYPES = [...OLD_PHOTO_TYPES, 'payment'];
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');

exports.up = (pgm) => {
  pgm.addColumns(TRIP, {
    closing_km: { type: 'numeric(10,1)' },
    returned_at: { type: 'timestamptz' },
  });
  pgm.addConstraint(TRIP, 'trip_closing_km_valid', {
    check: `(closing_km IS NULL) = (returned_at IS NULL)
            AND (closing_km IS NULL OR (closing_km >= 0 AND (opening_km IS NULL OR closing_km >= opening_km)))`,
  });

  pgm.addColumns(COLLECTION, {
    payer: { type: 'text', notNull: true, default: 'customer' },
    payer_name: { type: 'text' },
    reference: { type: 'text' },
  });
  pgm.addConstraint(COLLECTION, 'customer_collection_payer_valid', {
    check: `payer IN ('customer', 'third_party') AND (payer = 'customer' OR payer_name IS NOT NULL)`,
  });

  pgm.dropConstraint(PHOTO, 'trip_stop_photo_type_valid');
  pgm.addConstraint(PHOTO, 'trip_stop_photo_type_valid', { check: `photo_type IN (${list(PHOTO_TYPES)})` });
};

exports.down = (pgm) => {
  pgm.dropConstraint(PHOTO, 'trip_stop_photo_type_valid');
  pgm.sql('ALTER TABLE fulfilment.trip_stop_photo NO FORCE ROW LEVEL SECURITY');
  pgm.sql(`DELETE FROM fulfilment.trip_stop_photo WHERE photo_type NOT IN (${list(OLD_PHOTO_TYPES)})`);
  pgm.sql('ALTER TABLE fulfilment.trip_stop_photo FORCE ROW LEVEL SECURITY');
  pgm.addConstraint(PHOTO, 'trip_stop_photo_type_valid', { check: `photo_type IN (${list(OLD_PHOTO_TYPES)})` });
  pgm.dropConstraint(COLLECTION, 'customer_collection_payer_valid');
  pgm.dropColumns(COLLECTION, ['payer', 'payer_name', 'reference']);
  pgm.dropConstraint(TRIP, 'trip_closing_km_valid');
  pgm.dropColumns(TRIP, ['closing_km', 'returned_at']);
};
