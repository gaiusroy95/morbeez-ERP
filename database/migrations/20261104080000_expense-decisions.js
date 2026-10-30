/* eslint-disable camelcase */

// Owner app redesign, Phase 7 — the Approvals & Exceptions inbox
// (docs/redesign/owner-app-redesign-plan.md): a driver's expense beyond
// their authority (needs_approval) is approved or rejected on its own, with
// the owner's note, instead of only "with the closure". A rejected expense
// stays on the trip — closing it is an exception to settle with the driver;
// nothing is deducted from pay automatically (driver spec §23).

exports.shorthands = undefined;

const EXPENSE = { schema: 'fulfilment', name: 'trip_expense' };

exports.up = (pgm) => {
  pgm.addColumns(EXPENSE, {
    decision: { type: 'text' },
    decision_note: { type: 'text' },
    decided_by: { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' },
    decided_at: { type: 'timestamptz' },
  });
  pgm.addConstraint(EXPENSE, 'trip_expense_decision_valid', {
    check: `(decision IS NULL OR (needs_approval AND decision IN ('approved', 'rejected')))
            AND (decision IS NULL) = (decided_at IS NULL) AND (decision IS NULL) = (decided_by IS NULL)
            AND (decision IS DISTINCT FROM 'rejected' OR decision_note IS NOT NULL)`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint(EXPENSE, 'trip_expense_decision_valid');
  pgm.dropColumns(EXPENSE, ['decision', 'decision_note', 'decided_by', 'decided_at']);
};
