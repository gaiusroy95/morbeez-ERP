/* eslint-disable camelcase */

// Credit terms beyond limit and payment days. Customers owns the policy;
// Finance executes it (Domain Model, Customers; Accounting Engine, FC.1).
//
//   finance_charge_rate_monthly — percent per 30 days charged on overdue
//                                 invoices; 0 means none (the default).
//   finance_charge_grace_days   — days past due before a charge starts.
//   credit_hold                 — a manual stop: no new order for this
//                                 customer is confirmed while it's set,
//                                 whatever the limit says.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns(
    { schema: 'trading_partners', name: 'customer' },
    {
      finance_charge_rate_monthly: { type: 'numeric(5,2)', notNull: true, default: 0 },
      finance_charge_grace_days: { type: 'integer', notNull: true, default: 0 },
      credit_hold: { type: 'boolean', notNull: true, default: false },
      credit_hold_reason: { type: 'text' },
    },
  );
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_finance_charge_terms_range', {
    check: 'finance_charge_rate_monthly >= 0 AND finance_charge_rate_monthly <= 5 AND finance_charge_grace_days BETWEEN 0 AND 90',
  });
  pgm.addConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_credit_hold_has_reason', {
    check: 'NOT credit_hold OR credit_hold_reason IS NOT NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_credit_hold_has_reason');
  pgm.dropConstraint({ schema: 'trading_partners', name: 'customer' }, 'customer_finance_charge_terms_range');
  pgm.dropColumns({ schema: 'trading_partners', name: 'customer' }, [
    'finance_charge_rate_monthly',
    'finance_charge_grace_days',
    'credit_hold',
    'credit_hold_reason',
  ]);
};
