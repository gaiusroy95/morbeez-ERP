/* eslint-disable camelcase */

// Idempotency keys for the cash a driver records on the road (Security
// Audit SA-03; Constitution I.7, IV.3). The driver app queues each
// collection and expense with a key and replays it until the server
// answers; without a place to remember the key, a lost response meant the
// retry recorded the same cash a second time — on the customer's balance,
// the trip's reconciliation and the ledger. Keys are client-generated
// UUIDs, so one unique index across all rows is enough.

exports.up = (pgm) => {
  pgm.addColumn({ schema: 'money', name: 'customer_collection' }, { client_ref: { type: 'uuid' } });
  pgm.createIndex({ schema: 'money', name: 'customer_collection' }, 'client_ref', {
    name: 'customer_collection_client_ref_unique',
    unique: true,
    where: 'client_ref IS NOT NULL',
  });
  pgm.addColumn({ schema: 'fulfilment', name: 'trip_expense' }, { client_ref: { type: 'uuid' } });
  pgm.createIndex({ schema: 'fulfilment', name: 'trip_expense' }, 'client_ref', {
    name: 'trip_expense_client_ref_unique',
    unique: true,
    where: 'client_ref IS NOT NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex({ schema: 'fulfilment', name: 'trip_expense' }, 'client_ref', { name: 'trip_expense_client_ref_unique' });
  pgm.dropColumn({ schema: 'fulfilment', name: 'trip_expense' }, 'client_ref');
  pgm.dropIndex({ schema: 'money', name: 'customer_collection' }, 'client_ref', { name: 'customer_collection_client_ref_unique' });
  pgm.dropColumn({ schema: 'money', name: 'customer_collection' }, 'client_ref');
};
