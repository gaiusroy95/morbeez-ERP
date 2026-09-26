/* eslint-disable camelcase */

// Four tables, one framework:
//   approval_rule        — does this action type need approval at all, above what amount
//   approval_role_limit  — what can a given role approve, up to what amount (per action
//                          type, or a wildcard NULL action_type row for "every type")
//   approval_request     — one instance of "this needs a decision"
//   approval_delegation  — a time-boxed grant of one role's approval authority to another user
//
// Deliberately single-approver (one decision closes a request) and
// action_type is a plain string, not an enum or FK to a table of business
// object types — the calling context (a future Procurement, Finance,
// Vehicles module) owns what its own action types mean; this framework
// only needs to compare them for equality.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ---- approval_rule ----
  pgm.createTable(
    { schema: 'approvals', name: 'approval_rule' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      action_type: { type: 'text', notNull: true },
      // Any amount >= this requires approval. 0 means "always requires
      // approval" — the right value for a non-monetary action like a bad
      // debt write-off, where there's no natural amount to threshold on.
      threshold_amount: { type: 'numeric(14,2)', notNull: true, default: 0 },
      is_active: { type: 'boolean', notNull: true, default: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );
  pgm.addConstraint({ schema: 'approvals', name: 'approval_rule' }, 'approval_rule_tenant_action_unique', {
    unique: ['tenant_id', 'action_type'],
  });
  pgm.addConstraint({ schema: 'approvals', name: 'approval_rule' }, 'approval_rule_threshold_nonnegative', {
    check: 'threshold_amount >= 0',
  });
  pgm.sql('ALTER TABLE approvals.approval_rule ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE approvals.approval_rule FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY approval_rule_tenant_isolation ON approvals.approval_rule
      USING (tenant_id = current_tenant_id())
  `);

  // ---- approval_role_limit ----
  pgm.createTable(
    { schema: 'approvals', name: 'approval_role_limit' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      role_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'role' },
        onDelete: 'CASCADE',
      },
      // NULL = a wildcard limit applying to every action type not covered
      // by a more specific row for the same role (Owner's "unlimited,
      // everything" row, typically).
      action_type: { type: 'text' },
      // NULL = unlimited for this role/action_type.
      max_amount: { type: 'numeric(14,2)' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );
  pgm.addConstraint({ schema: 'approvals', name: 'approval_role_limit' }, 'approval_role_limit_max_amount_nonnegative', {
    check: 'max_amount IS NULL OR max_amount >= 0',
  });
  // Two partial unique indexes rather than one plain unique constraint —
  // Postgres treats every NULL as distinct, so a plain
  // UNIQUE(tenant_id, role_id, action_type) would let the same role
  // accumulate unlimited duplicate wildcard rows.
  pgm.createIndex(
    { schema: 'approvals', name: 'approval_role_limit' },
    ['tenant_id', 'role_id', 'action_type'],
    { unique: true, where: 'action_type IS NOT NULL', name: 'approval_role_limit_specific_unique' },
  );
  pgm.createIndex(
    { schema: 'approvals', name: 'approval_role_limit' },
    ['tenant_id', 'role_id'],
    { unique: true, where: 'action_type IS NULL', name: 'approval_role_limit_wildcard_unique' },
  );
  pgm.sql('ALTER TABLE approvals.approval_role_limit ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE approvals.approval_role_limit FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY approval_role_limit_tenant_isolation ON approvals.approval_role_limit
      USING (tenant_id = current_tenant_id())
  `);

  // ---- approval_request ----
  pgm.createTable(
    { schema: 'approvals', name: 'approval_request' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      action_type: { type: 'text', notNull: true },
      subject_id: { type: 'uuid', notNull: true },
      amount: { type: 'numeric(14,2)' }, // NULL for a non-monetary action
      status: { type: 'text', notNull: true, default: 'pending' }, // pending | approved | rejected | cancelled
      requested_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      decided_by: {
        type: 'uuid',
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      // Which role's authority the decision was made under — the role
      // held directly, or the role named in the delegation that was used
      // (approval_delegation.role_id), never left ambiguous after the fact.
      decided_via_role_id: {
        type: 'uuid',
        references: { schema: 'identity', name: 'role' },
        onDelete: 'RESTRICT',
      },
      decided_via_delegation_id: { type: 'uuid' }, // set only when decided via delegation; FK added below once approval_delegation exists
      decision_note: { type: 'text' },
      decided_at: { type: 'timestamptz' },
      version: { type: 'integer', notNull: true, default: 1 },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'approvals', name: 'approval_request' }, 'approval_request_status_valid', {
    check: "status IN ('pending', 'approved', 'rejected', 'cancelled')",
  });
  pgm.addConstraint({ schema: 'approvals', name: 'approval_request' }, 'approval_request_decider_differs_from_requester', {
    // Segregation of duties, enforced at the database, not just in the
    // service (Accounting Engine, CN.4's spirit, generalized) — nothing
    // can ever record a request approved by the person who filed it.
    check: 'decided_by IS NULL OR decided_by <> requested_by',
  });
  pgm.createIndex(
    { schema: 'approvals', name: 'approval_request' },
    ['tenant_id', 'status'],
  );
  pgm.createIndex(
    { schema: 'approvals', name: 'approval_request' },
    ['tenant_id', 'action_type', 'subject_id'],
  );
  pgm.sql('ALTER TABLE approvals.approval_request ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE approvals.approval_request FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY approval_request_tenant_isolation ON approvals.approval_request
      USING (tenant_id = current_tenant_id())
  `);

  // ---- approval_delegation ----
  pgm.createTable(
    { schema: 'approvals', name: 'approval_delegation' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'tenant', name: 'tenant' },
        onDelete: 'RESTRICT',
      },
      role_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'role' },
        onDelete: 'CASCADE',
      },
      delegator_user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      delegate_user_id: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
      starts_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      ends_at: { type: 'timestamptz', notNull: true },
      revoked_at: { type: 'timestamptz' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
      created_by: {
        type: 'uuid',
        notNull: true,
        references: { schema: 'identity', name: 'app_user' },
        onDelete: 'RESTRICT',
      },
    },
  );
  pgm.addConstraint({ schema: 'approvals', name: 'approval_delegation' }, 'approval_delegation_window_valid', {
    // Time-boxed by construction — no such thing as a permanent
    // delegation in this framework, and 180 days is a deliberate ceiling
    // against one disguised as "long," not just "must end eventually."
    check: "ends_at > starts_at AND ends_at <= starts_at + interval '180 days'",
  });
  pgm.addConstraint({ schema: 'approvals', name: 'approval_delegation' }, 'approval_delegation_not_to_self', {
    check: 'delegate_user_id <> delegator_user_id',
  });
  pgm.createIndex(
    { schema: 'approvals', name: 'approval_delegation' },
    ['tenant_id', 'delegate_user_id', 'role_id'],
  );
  pgm.sql('ALTER TABLE approvals.approval_delegation ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE approvals.approval_delegation FORCE ROW LEVEL SECURITY');
  pgm.sql(`
    CREATE POLICY approval_delegation_tenant_isolation ON approvals.approval_delegation
      USING (tenant_id = current_tenant_id())
  `);

  // Added last, once both tables exist — raw SQL rather than
  // pgm.addConstraint(), so this doesn't depend on getting an option
  // shape exactly right for a one-off cross-table FK.
  pgm.sql(`
    ALTER TABLE approvals.approval_request
      ADD CONSTRAINT approval_request_delegation_fk
      FOREIGN KEY (decided_via_delegation_id)
      REFERENCES approvals.approval_delegation(id)
      ON DELETE RESTRICT
  `);
};

exports.down = (pgm) => {
  // The cross-table FK added last in `up` goes first here, or the
  // delegation table can't be dropped while approval_request depends on it.
  pgm.sql('ALTER TABLE approvals.approval_request DROP CONSTRAINT approval_request_delegation_fk');
  pgm.dropTable({ schema: 'approvals', name: 'approval_delegation' });
  pgm.dropTable({ schema: 'approvals', name: 'approval_request' });
  pgm.dropTable({ schema: 'approvals', name: 'approval_role_limit' });
  pgm.dropTable({ schema: 'approvals', name: 'approval_rule' });
};
