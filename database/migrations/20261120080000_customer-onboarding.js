/* eslint-disable camelcase */
// Customer onboarding (the client, 20 Nov 2026): a new customer is taken
// down with who to ask for, where the shop is and what it looks like —
// "Name, Contact person, Phone number, location: GPS coordinates, Land mark,
// Shop photo front".
//
// - The contact person sits with the phone and email in `contact` (jsonb):
//   no column.
// - The GPS position is the customer's map pin (fulfilment.place_pin), the
//   one route planning and the driver's stop already read: no column.
// - trading_partners.customer.landmark — how a driver finds the shop ("opposite
//   the bus stand"), beside the village/town and the address.
// - trading_partners.customer.shop_photo_* — the photo of the shop's front:
//   where it is kept (object storage key), its type and when it was taken.
//   All three together or none.
//
// Columns only, no backfill: every existing customer has no landmark and no
// photo.

exports.shorthands = undefined;

const customer = { schema: 'trading_partners', name: 'customer' };

exports.up = (pgm) => {
  pgm.addColumns(customer, {
    landmark: { type: 'text' },
    shop_photo_key: { type: 'text' },
    shop_photo_type: { type: 'text' },
    shop_photo_at: { type: 'timestamptz' },
  });
  pgm.addConstraint(customer, 'customer_landmark_valid', {
    check: 'landmark IS NULL OR (length(btrim(landmark)) BETWEEN 1 AND 200)',
  });
  pgm.addConstraint(customer, 'customer_shop_photo_valid', {
    check: `(shop_photo_key IS NULL) = (shop_photo_type IS NULL)
            AND (shop_photo_key IS NULL) = (shop_photo_at IS NULL)
            AND (shop_photo_type IS NULL OR shop_photo_type IN ('image/jpeg', 'image/png', 'image/webp'))`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint(customer, 'customer_shop_photo_valid');
  pgm.dropConstraint(customer, 'customer_landmark_valid');
  pgm.dropColumns(customer, ['landmark', 'shop_photo_key', 'shop_photo_type', 'shop_photo_at']);
};
