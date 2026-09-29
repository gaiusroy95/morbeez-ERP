/* eslint-disable camelcase */

// The India tax layer — GST on sales, HSN classification, TDS on payments,
// and e-invoice readiness — in its own `tax` schema.
//
// Rules are data, not code. GST rates (tax.gst_rate) and TDS sections
// (tax.tds_section) are effective-dated rows: system defaults (tenant_id
// NULL) that every tenant sees, plus a tenant's own rows, which win over a
// default for the same code. A rate change is a new row from a new date,
// never an edit — an invoice or deduction keeps the rule it was computed
// with.
//
// Tax registrations sit beside the master data they describe (a product's
// HSN, a customer's GSTIN and address, a farmer's PAN), owned by Tax.
// What an invoice was taxed at is snapshotted when it's issued
// (tax.invoice_tax, tax.invoice_line_tax) and never changes. TDS withheld
// from a farmer's payable reduces what's owed on it: the payable view
// below subtracts it.
//
// The seeded defaults are a starting point, not advice: rates, thresholds,
// and section numbers change (the Income-tax Act, 2025 renumbers TDS
// sections from 1 April 2026). Each tenant's accountant should confirm
// them — and change them here, without a code release.

exports.shorthands = undefined;

const literal = (value) => (value === null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);

// ---- Defaults ----

// Fresh or chilled vegetables are exempt (Notification 2/2017-Central Tax
// (Rate)); frozen, dried, or processed ones are not in these headings'
// exemption and need their own rule.
const GST_DEFAULTS = [
  ['0701', 'Potatoes, fresh or chilled'],
  ['0702', 'Tomatoes, fresh or chilled'],
  ['0703', 'Onions, shallots, garlic, leeks, fresh or chilled'],
  ['0704', 'Cabbages, cauliflowers, kohlrabi, kale, fresh or chilled'],
  ['0705', 'Lettuce and chicory, fresh or chilled'],
  ['0706', 'Carrots, turnips, beetroot, radishes and similar roots, fresh or chilled'],
  ['0707', 'Cucumbers and gherkins, fresh or chilled'],
  ['0708', 'Leguminous vegetables (peas, beans), fresh or chilled'],
  ['0709', 'Other vegetables (chillies, okra, leafy vegetables…), fresh or chilled'],
  ['0714', 'Cassava, sweet potatoes and similar roots, fresh or chilled'],
];

// [code, description, rate individual/HUF %, rate other %, rate without PAN %,
//  single-transaction threshold, annual threshold, basis]
const TDS_DEFAULTS = [
  ['194Q', 'Purchase of goods — buyer with turnover above ₹10 crore (1961 Act numbering)', 0.1, 0.1, 5, null, 5000000, 'excess_over_annual'],
  ['194C', 'Payments to contractors, e.g. hired transport (1961 Act numbering)', 1, 2, 20, 30000, 100000, 'full_once_crossed'],
  ['194I(b)', 'Rent of land, building or furniture — threshold per month (1961 Act numbering)', 10, 10, 20, 50000, null, 'full_once_crossed'],
  ['194J(b)', 'Fees for professional services (1961 Act numbering)', 10, 10, 20, null, 50000, 'full_once_crossed'],
];

const tenantColumn = { type: 'uuid', notNull: true, references: { schema: 'tenant', name: 'tenant' }, onDelete: 'CASCADE' };
const userColumn = { type: 'uuid', references: { schema: 'identity', name: 'app_user' }, onDelete: 'RESTRICT' };

const GSTIN = "'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'";
const PAN = "'^[A-Z]{5}[0-9]{4}[A-Z]$'";
const TAN = "'^[A-Z]{4}[0-9]{5}[A-Z]$'";
const PINCODE = "'^[1-9][0-9]{5}$'";
const STATE = "'^[0-9]{2}$'";

function isolate(pgm, table) {
  pgm.sql(`ALTER TABLE tax.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE tax.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`CREATE POLICY ${table}_tenant_isolation ON tax.${table} USING (tenant_id = current_tenant_id())`);
  pgm.sql(`GRANT SELECT, INSERT ON tax.${table} TO morbeez_app`);
}

// Readable defaults (tenant_id NULL) plus the tenant's own rows; the app
// writes only its own.
function isolateWithDefaults(pgm, table) {
  pgm.sql(`ALTER TABLE tax.${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE tax.${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(
    `CREATE POLICY ${table}_read ON tax.${table} FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id())`,
  );
  pgm.sql(`CREATE POLICY ${table}_insert ON tax.${table} FOR INSERT WITH CHECK (tenant_id = current_tenant_id())`);
  pgm.sql(
    `CREATE POLICY ${table}_update ON tax.${table} FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())`,
  );
  pgm.sql(`GRANT SELECT, INSERT ON tax.${table} TO morbeez_app`);
  // Only an end date can change: a rate, once in force, is history.
  pgm.sql(`GRANT UPDATE (effective_to) ON tax.${table} TO morbeez_app`);
}

exports.up = (pgm) => {
  pgm.createSchema('tax', { ifNotExists: true });
  pgm.sql('GRANT USAGE ON SCHEMA tax TO morbeez_app');

  // ---- The tenant's own registration ----
  pgm.createTable(
    { schema: 'tax', name: 'tax_profile' },
    {
      tenant_id: { ...tenantColumn, primaryKey: true },
      registration_type: { type: 'text', notNull: true, default: 'unregistered' },
      gstin: { type: 'text' },
      legal_name: { type: 'text' },
      trade_name: { type: 'text' },
      address_line1: { type: 'text' },
      address_line2: { type: 'text' },
      city: { type: 'text' },
      pincode: { type: 'text' },
      state_code: { type: 'text' },
      pan: { type: 'text' },
      tan: { type: 'text' },
      hsn_min_digits: { type: 'integer', notNull: true, default: 4 },
      b2cl_threshold: { type: 'numeric(14,2)', notNull: true, default: 100000 },
      einvoice_enabled: { type: 'boolean', notNull: true, default: false },
      einvoice_report_within_days: { type: 'integer' },
      farmer_tds_section: { type: 'text' },
      version: { type: 'integer', notNull: true, default: 1 },
      updated_by: userColumn,
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  const profile = { schema: 'tax', name: 'tax_profile' };
  pgm.addConstraint(profile, 'tax_profile_registration_type_valid', {
    check: "registration_type IN ('regular', 'composition', 'unregistered')",
  });
  pgm.addConstraint(profile, 'tax_profile_registered_has_gstin', {
    check: "registration_type = 'unregistered' OR gstin IS NOT NULL",
  });
  pgm.addConstraint(profile, 'tax_profile_formats', {
    check: `(gstin IS NULL OR gstin ~ ${GSTIN}) AND (pan IS NULL OR pan ~ ${PAN}) AND (tan IS NULL OR tan ~ ${TAN})
            AND (pincode IS NULL OR pincode ~ ${PINCODE}) AND (state_code IS NULL OR state_code ~ ${STATE})`,
  });
  pgm.addConstraint(profile, 'tax_profile_state_matches_gstin', {
    check: 'gstin IS NULL OR state_code = left(gstin, 2)',
  });
  pgm.addConstraint(profile, 'tax_profile_hsn_digits_valid', { check: 'hsn_min_digits IN (4, 6, 8)' });
  pgm.addConstraint(profile, 'tax_profile_einvoice_window_valid', {
    check: 'einvoice_report_within_days IS NULL OR einvoice_report_within_days BETWEEN 1 AND 365',
  });
  pgm.sql('ALTER TABLE tax.tax_profile ENABLE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE tax.tax_profile FORCE ROW LEVEL SECURITY');
  pgm.sql('CREATE POLICY tax_profile_tenant_isolation ON tax.tax_profile USING (tenant_id = current_tenant_id())');
  pgm.sql('GRANT SELECT, INSERT, UPDATE ON tax.tax_profile TO morbeez_app');

  // ---- Rules ----
  pgm.createTable(
    { schema: 'tax', name: 'gst_rate' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', references: { schema: 'tenant', name: 'tenant' }, onDelete: 'CASCADE' },
      hsn_code: { type: 'text', notNull: true },
      description: { type: 'text', notNull: true },
      supply_kind: { type: 'text', notNull: true, default: 'goods' },
      taxability: { type: 'text', notNull: true },
      rate: { type: 'numeric(5,2)', notNull: true, default: 0 },
      cess_rate: { type: 'numeric(5,2)', notNull: true, default: 0 },
      effective_from: { type: 'date', notNull: true },
      effective_to: { type: 'date' },
      created_by: userColumn,
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  const gst = { schema: 'tax', name: 'gst_rate' };
  pgm.addConstraint(gst, 'gst_rate_code_format', { check: "hsn_code ~ '^[0-9]{2,8}$'" });
  pgm.addConstraint(gst, 'gst_rate_kind_valid', { check: "supply_kind IN ('goods', 'services')" });
  pgm.addConstraint(gst, 'gst_rate_taxability_valid', {
    check: "taxability IN ('taxable', 'nil_rated', 'exempt', 'non_gst')",
  });
  pgm.addConstraint(gst, 'gst_rate_rates_valid', {
    check:
      // A taxable rule charges something; every other kind charges nothing.
      "rate BETWEEN 0 AND 100 AND cess_rate BETWEEN 0 AND 400 AND CASE WHEN taxability = 'taxable' THEN rate > 0 OR cess_rate > 0 ELSE rate = 0 AND cess_rate = 0 END",
  });
  pgm.addConstraint(gst, 'gst_rate_dates_ordered', { check: 'effective_to IS NULL OR effective_to >= effective_from' });
  pgm.sql(
    `CREATE UNIQUE INDEX gst_rate_one_per_start ON tax.gst_rate
       (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), hsn_code, effective_from)`,
  );
  isolateWithDefaults(pgm, 'gst_rate');

  pgm.createTable(
    { schema: 'tax', name: 'tds_section' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: { type: 'uuid', references: { schema: 'tenant', name: 'tenant' }, onDelete: 'CASCADE' },
      code: { type: 'text', notNull: true },
      description: { type: 'text', notNull: true },
      rate_individual: { type: 'numeric(6,3)', notNull: true },
      rate_other: { type: 'numeric(6,3)', notNull: true },
      rate_no_pan: { type: 'numeric(6,3)', notNull: true },
      single_threshold: { type: 'numeric(14,2)' },
      annual_threshold: { type: 'numeric(14,2)' },
      basis: { type: 'text', notNull: true },
      effective_from: { type: 'date', notNull: true },
      effective_to: { type: 'date' },
      created_by: userColumn,
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  const tds = { schema: 'tax', name: 'tds_section' };
  pgm.addConstraint(tds, 'tds_section_code_format', { check: "code ~ '^[0-9A-Za-z()/.-]{2,20}$'" });
  pgm.addConstraint(tds, 'tds_section_basis_valid', { check: "basis IN ('excess_over_annual', 'full_once_crossed')" });
  pgm.addConstraint(tds, 'tds_section_rates_valid', {
    check:
      'rate_individual >= 0 AND rate_individual <= 100 AND rate_other >= 0 AND rate_other <= 100 AND rate_no_pan >= 0 AND rate_no_pan <= 100',
  });
  pgm.addConstraint(tds, 'tds_section_thresholds_valid', {
    check:
      "(single_threshold IS NULL OR single_threshold >= 0) AND (annual_threshold IS NULL OR annual_threshold >= 0) AND (basis <> 'excess_over_annual' OR annual_threshold IS NOT NULL)",
  });
  pgm.addConstraint(tds, 'tds_section_dates_ordered', { check: 'effective_to IS NULL OR effective_to >= effective_from' });
  pgm.sql(
    `CREATE UNIQUE INDEX tds_section_one_per_start ON tax.tds_section
       (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code, effective_from)`,
  );
  isolateWithDefaults(pgm, 'tds_section');

  // The defaults (tenant_id NULL) are written by the migration role, which
  // owns these tables. FORCE applies RLS to the owner too, and a managed
  // Postgres owner (RDS's master user) is no superuser to be exempt — so
  // FORCE is lifted for exactly these two statements and restored after,
  // leaving the tables as isolated as before.
  pgm.sql('ALTER TABLE tax.gst_rate NO FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE tax.tds_section NO FORCE ROW LEVEL SECURITY');
  pgm.sql(
    `INSERT INTO tax.gst_rate (tenant_id, hsn_code, description, supply_kind, taxability, rate, effective_from) VALUES
     ${GST_DEFAULTS.map(([code, text]) => `(NULL, ${literal(code)}, ${literal(text)}, 'goods', 'exempt', 0, '2017-07-01')`).join(',\n     ')}`,
  );
  pgm.sql(
    `INSERT INTO tax.tds_section
       (tenant_id, code, description, rate_individual, rate_other, rate_no_pan, single_threshold, annual_threshold, basis, effective_from) VALUES
     ${TDS_DEFAULTS.map(
       ([code, text, ind, other, noPan, single, annual, basis]) =>
         `(NULL, ${literal(code)}, ${literal(text)}, ${ind}, ${other}, ${noPan}, ${single ?? 'NULL'}, ${annual ?? 'NULL'}, ${literal(basis)}, '2025-04-01')`,
     ).join(',\n     ')}`,
  );
  pgm.sql('ALTER TABLE tax.gst_rate FORCE ROW LEVEL SECURITY');
  pgm.sql('ALTER TABLE tax.tds_section FORCE ROW LEVEL SECURITY');

  // ---- Registrations of the parties and products Tax describes ----
  pgm.createTable(
    { schema: 'tax', name: 'product_tax' },
    {
      product_id: {
        type: 'uuid',
        primaryKey: true,
        references: { schema: 'trading_partners', name: 'product' },
        onDelete: 'CASCADE',
      },
      tenant_id: tenantColumn,
      hsn_code: { type: 'text', notNull: true },
      version: { type: 'integer', notNull: true, default: 1 },
      updated_by: userColumn,
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'tax', name: 'product_tax' }, 'product_tax_hsn_format', { check: "hsn_code ~ '^[0-9]{4,8}$'" });
  isolate(pgm, 'product_tax');
  pgm.sql('GRANT UPDATE (hsn_code, version, updated_by, updated_at) ON tax.product_tax TO morbeez_app');

  pgm.createTable(
    { schema: 'tax', name: 'customer_tax' },
    {
      customer_id: {
        type: 'uuid',
        primaryKey: true,
        references: { schema: 'trading_partners', name: 'customer' },
        onDelete: 'CASCADE',
      },
      tenant_id: tenantColumn,
      gstin: { type: 'text' },
      legal_name: { type: 'text' },
      state_code: { type: 'text', notNull: true },
      address_line1: { type: 'text' },
      city: { type: 'text' },
      pincode: { type: 'text' },
      version: { type: 'integer', notNull: true, default: 1 },
      updated_by: userColumn,
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'tax', name: 'customer_tax' }, 'customer_tax_formats', {
    check: `(gstin IS NULL OR gstin ~ ${GSTIN}) AND state_code ~ ${STATE} AND (pincode IS NULL OR pincode ~ ${PINCODE})
            AND (gstin IS NULL OR state_code = left(gstin, 2))`,
  });
  isolate(pgm, 'customer_tax');
  pgm.sql(
    'GRANT UPDATE (gstin, legal_name, state_code, address_line1, city, pincode, version, updated_by, updated_at) ON tax.customer_tax TO morbeez_app',
  );

  pgm.createTable(
    { schema: 'tax', name: 'farmer_tax' },
    {
      farmer_id: {
        type: 'uuid',
        primaryKey: true,
        references: { schema: 'trading_partners', name: 'farmer' },
        onDelete: 'CASCADE',
      },
      tenant_id: tenantColumn,
      pan: { type: 'text' },
      // null = read it from the PAN's fourth character (P individual, H HUF…).
      deductee_type: { type: 'text' },
      tds_exempt: { type: 'boolean', notNull: true, default: false },
      exempt_reason: { type: 'text' },
      version: { type: 'integer', notNull: true, default: 1 },
      updated_by: userColumn,
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'tax', name: 'farmer_tax' }, 'farmer_tax_valid', {
    check: `(pan IS NULL OR pan ~ ${PAN}) AND (deductee_type IS NULL OR deductee_type IN ('individual_huf', 'other'))
            AND (NOT tds_exempt OR length(btrim(coalesce(exempt_reason, ''))) >= 3)`,
  });
  isolate(pgm, 'farmer_tax');
  pgm.sql(
    'GRANT UPDATE (pan, deductee_type, tds_exempt, exempt_reason, version, updated_by, updated_at) ON tax.farmer_tax TO morbeez_app',
  );

  // ---- What each invoice was taxed at, fixed when it was issued ----
  pgm.createTable(
    { schema: 'tax', name: 'invoice_tax' },
    {
      invoice_id: { type: 'uuid', primaryKey: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      tenant_id: tenantColumn,
      document_type: { type: 'text', notNull: true },
      registration_type: { type: 'text', notNull: true },
      supplier_gstin: { type: 'text' },
      supplier_state: { type: 'text' },
      buyer_gstin: { type: 'text' },
      buyer_legal_name: { type: 'text' },
      buyer_address_line1: { type: 'text' },
      buyer_city: { type: 'text' },
      buyer_pincode: { type: 'text' },
      place_of_supply: { type: 'text' },
      intra_state: { type: 'boolean', notNull: true },
      taxable_value: { type: 'numeric(14,2)', notNull: true },
      cgst: { type: 'numeric(14,2)', notNull: true, default: 0 },
      sgst: { type: 'numeric(14,2)', notNull: true, default: 0 },
      igst: { type: 'numeric(14,2)', notNull: true, default: 0 },
      cess: { type: 'numeric(14,2)', notNull: true, default: 0 },
      total: { type: 'numeric(14,2)', notNull: true },
    },
  );
  pgm.addConstraint({ schema: 'tax', name: 'invoice_tax' }, 'invoice_tax_document_type_valid', {
    check: "document_type IN ('tax_invoice', 'bill_of_supply', 'invoice')",
  });
  pgm.addConstraint({ schema: 'tax', name: 'invoice_tax' }, 'invoice_tax_totals_add_up', {
    check: 'total = taxable_value + cgst + sgst + igst + cess AND (intra_state OR (cgst = 0 AND sgst = 0)) AND (NOT intra_state OR igst = 0)',
  });
  isolate(pgm, 'invoice_tax');

  pgm.createTable(
    { schema: 'tax', name: 'invoice_line_tax' },
    {
      invoice_line_id: {
        type: 'uuid',
        primaryKey: true,
        references: { schema: 'money', name: 'invoice_line' },
        onDelete: 'RESTRICT',
      },
      tenant_id: tenantColumn,
      invoice_id: { type: 'uuid', notNull: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      hsn_code: { type: 'text' },
      uqc: { type: 'text', notNull: true },
      // 'unclassified': no HSN on the product, or no rule for it — not taxed,
      // and flagged on the returns and e-invoice readiness until fixed.
      taxability: { type: 'text', notNull: true },
      gst_rate: { type: 'numeric(5,2)', notNull: true, default: 0 },
      cess_rate: { type: 'numeric(5,2)', notNull: true, default: 0 },
      rule_id: { type: 'uuid', references: { schema: 'tax', name: 'gst_rate' }, onDelete: 'RESTRICT' },
      taxable_value: { type: 'numeric(14,2)', notNull: true },
      cgst: { type: 'numeric(14,2)', notNull: true, default: 0 },
      sgst: { type: 'numeric(14,2)', notNull: true, default: 0 },
      igst: { type: 'numeric(14,2)', notNull: true, default: 0 },
      cess: { type: 'numeric(14,2)', notNull: true, default: 0 },
    },
  );
  pgm.addConstraint({ schema: 'tax', name: 'invoice_line_tax' }, 'invoice_line_tax_taxability_valid', {
    check: "taxability IN ('taxable', 'nil_rated', 'exempt', 'non_gst', 'unclassified', 'not_registered')",
  });
  pgm.createIndex({ schema: 'tax', name: 'invoice_line_tax' }, 'invoice_id');
  isolate(pgm, 'invoice_line_tax');

  // ---- TDS ----
  pgm.createTable(
    { schema: 'tax', name: 'tds_challan' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      section_code: { type: 'text', notNull: true },
      tax_amount: { type: 'numeric(14,2)', notNull: true },
      interest: { type: 'numeric(14,2)', notNull: true, default: 0 },
      paid_on: { type: 'date', notNull: true },
      bsr_code: { type: 'text', notNull: true },
      challan_serial: { type: 'text', notNull: true },
      paid_from: { type: 'text', notNull: true },
      ledger_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
      created_by: { ...userColumn, notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'tax', name: 'tds_challan' }, 'tds_challan_valid', {
    check: "tax_amount > 0 AND interest >= 0 AND bsr_code ~ '^[0-9]{7}$' AND challan_serial ~ '^[0-9]{5}$' AND paid_from IN ('bank', 'cash_on_hand')",
  });
  pgm.addConstraint({ schema: 'tax', name: 'tds_challan' }, 'tds_challan_unique', {
    unique: ['tenant_id', 'bsr_code', 'paid_on', 'challan_serial'],
  });
  isolate(pgm, 'tds_challan');

  pgm.createTable(
    { schema: 'tax', name: 'tds_deduction' },
    {
      id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
      tenant_id: tenantColumn,
      section_id: { type: 'uuid', notNull: true, references: { schema: 'tax', name: 'tds_section' }, onDelete: 'RESTRICT' },
      section_code: { type: 'text', notNull: true },
      farmer_id: { type: 'uuid', references: { schema: 'trading_partners', name: 'farmer' }, onDelete: 'RESTRICT' },
      payee_name: { type: 'text', notNull: true },
      payee_pan: { type: 'text' },
      deductee_type: { type: 'text', notNull: true },
      base_amount: { type: 'numeric(14,2)', notNull: true },
      gross_amount: { type: 'numeric(14,2)', notNull: true },
      rate: { type: 'numeric(6,3)', notNull: true },
      tds_amount: { type: 'numeric(14,2)', notNull: true },
      deducted_on: { type: 'date', notNull: true },
      payable_id: { type: 'uuid', references: { schema: 'money', name: 'farmer_payable' }, onDelete: 'RESTRICT' },
      source_type: { type: 'text', notNull: true },
      source_id: { type: 'uuid', notNull: true },
      ledger_entry_id: { type: 'uuid', references: { schema: 'money', name: 'ledger_entry' }, onDelete: 'RESTRICT' },
      challan_id: { type: 'uuid', references: { schema: 'tax', name: 'tds_challan' }, onDelete: 'RESTRICT' },
      created_by: { ...userColumn, notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  const deduction = { schema: 'tax', name: 'tds_deduction' };
  pgm.addConstraint(deduction, 'tds_deduction_amounts_valid', {
    check: 'tds_amount > 0 AND base_amount > 0 AND gross_amount >= base_amount AND rate > 0',
  });
  pgm.addConstraint(deduction, 'tds_deduction_deductee_valid', {
    check: `deductee_type IN ('individual_huf', 'other', 'no_pan') AND (payee_pan IS NULL OR payee_pan ~ ${PAN})`,
  });
  pgm.addConstraint(deduction, 'tds_deduction_one_per_payable', { unique: ['payable_id'] });
  pgm.addConstraint(deduction, 'tds_deduction_one_per_source', { unique: ['tenant_id', 'source_type', 'source_id'] });
  pgm.createIndex(deduction, ['tenant_id', 'deducted_on']);
  pgm.createIndex(deduction, ['tenant_id', 'farmer_id', 'deducted_on']);
  isolate(pgm, 'tds_deduction');
  // A deduction is only ever updated to link it to the challan that paid it over.
  pgm.sql('GRANT UPDATE (challan_id) ON tax.tds_deduction TO morbeez_app');

  // ---- E-invoice registration (IRN) ----
  pgm.createTable(
    { schema: 'tax', name: 'einvoice' },
    {
      invoice_id: { type: 'uuid', primaryKey: true, references: { schema: 'money', name: 'invoice' }, onDelete: 'RESTRICT' },
      tenant_id: tenantColumn,
      irn: { type: 'text', notNull: true },
      ack_no: { type: 'text', notNull: true },
      ack_date: { type: 'timestamptz', notNull: true },
      signed_qr: { type: 'text' },
      status: { type: 'text', notNull: true, default: 'active' },
      cancelled_at: { type: 'timestamptz' },
      cancel_reason_code: { type: 'text' },
      cancel_remark: { type: 'text' },
      recorded_by: { ...userColumn, notNull: true },
      recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
  );
  pgm.addConstraint({ schema: 'tax', name: 'einvoice' }, 'einvoice_valid', {
    check:
      "irn ~ '^[0-9a-f]{64}$' AND ack_no ~ '^[0-9]{1,20}$' AND status IN ('active', 'cancelled') AND (status = 'cancelled') = (cancelled_at IS NOT NULL) AND (cancel_reason_code IS NULL OR cancel_reason_code IN ('1', '2', '3', '4'))",
  });
  pgm.addConstraint({ schema: 'tax', name: 'einvoice' }, 'einvoice_irn_unique', { unique: ['tenant_id', 'irn'] });
  isolate(pgm, 'einvoice');
  pgm.sql('GRANT UPDATE (status, cancelled_at, cancel_reason_code, cancel_remark) ON tax.einvoice TO morbeez_app');

  // ---- A farmer's payable is owed net of TDS withheld on it ----
  pgm.sql(`
    CREATE OR REPLACE VIEW money.farmer_payable_balance WITH (security_invoker = true) AS
    SELECT fp.id AS payable_id, fp.tenant_id, fp.lot_id, fp.farmer_id, fp.amount, fp.accrued_at,
           COALESCE(a.paid, 0)::numeric(12,2) AS paid,
           (fp.amount - COALESCE(a.paid, 0) - COALESCE(t.withheld, 0))::numeric(12,2) AS outstanding,
           COALESCE(t.withheld, 0)::numeric(12,2) AS tds_withheld
    FROM money.farmer_payable fp
    LEFT JOIN (
      SELECT payable_id, SUM(amount) AS paid FROM money.farmer_payment_allocation GROUP BY payable_id
    ) a ON a.payable_id = fp.id
    LEFT JOIN (
      SELECT payable_id, SUM(tds_amount) AS withheld FROM tax.tds_deduction WHERE payable_id IS NOT NULL GROUP BY payable_id
    ) t ON t.payable_id = fp.id
  `);

  // ---- Ledger accounts GST and TDS post to ----
  pgm.sql(`
    INSERT INTO money.ledger_account (code, name, root_type, number, report_group, is_system, is_control) VALUES
      ('output_cgst', 'Output CGST payable', 'liability', 2100, 'current_liability', true, false),
      ('output_sgst', 'Output SGST / UTGST payable', 'liability', 2110, 'current_liability', true, false),
      ('output_igst', 'Output IGST payable', 'liability', 2120, 'current_liability', true, false),
      ('output_cess', 'GST compensation cess payable', 'liability', 2130, 'current_liability', true, false),
      ('tds_payable', 'TDS payable', 'liability', 2200, 'current_liability', true, false)
    ON CONFLICT (code) DO NOTHING
  `);
  pgm.sql('SELECT money.install_chart_of_accounts(id) FROM tenant.tenant');

  // ---- Permissions ----
  pgm.sql(`
    INSERT INTO identity.permission (code, description) VALUES
      ('tax:read', 'View GST and TDS settings, tax on invoices, returns data, TDS registers, and e-invoice status'),
      ('tax:configure', 'Change the tax registration, GST rates and HSN codes, TDS sections, and tax details of customers, farmers, and products'),
      ('tax:file', 'Record TDS deductions and deposits, and e-invoice registrations (IRN)')
    ON CONFLICT (code) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql("DELETE FROM identity.permission WHERE code IN ('tax:read', 'tax:configure', 'tax:file')");
  // CREATE OR REPLACE can't drop a column; rebuild the view without it.
  pgm.sql('DROP VIEW money.farmer_payable_balance');
  pgm.sql(`
    CREATE VIEW money.farmer_payable_balance WITH (security_invoker = true) AS
    SELECT fp.id AS payable_id, fp.tenant_id, fp.lot_id, fp.farmer_id, fp.amount, fp.accrued_at,
           COALESCE(a.paid, 0)::numeric(12,2) AS paid,
           (fp.amount - COALESCE(a.paid, 0))::numeric(12,2) AS outstanding
    FROM money.farmer_payable fp
    LEFT JOIN (
      SELECT payable_id, SUM(amount) AS paid FROM money.farmer_payment_allocation GROUP BY payable_id
    ) a ON a.payable_id = fp.id
  `);
  pgm.sql('REVOKE INSERT, UPDATE, DELETE ON money.farmer_payable_balance FROM morbeez_app');
  pgm.sql('GRANT SELECT ON money.farmer_payable_balance TO morbeez_app');
  pgm.sql(
    "DELETE FROM money.account WHERE code IN ('output_cgst', 'output_sgst', 'output_igst', 'output_cess', 'tds_payable')",
  );
  pgm.sql(
    "DELETE FROM money.ledger_account WHERE code IN ('output_cgst', 'output_sgst', 'output_igst', 'output_cess', 'tds_payable')",
  );
  pgm.dropSchema('tax', { cascade: true });
};
