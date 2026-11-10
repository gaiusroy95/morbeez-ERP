/* eslint-disable camelcase */

// An index for every business foreign key that had none (Master Spec v3 §62:
// indexing for the high-frequency queries — by customer, farmer, product,
// route, trip, vehicle, driver, procurement, inventory, delivery, payment,
// workforce, accounting). Found by database/scripts/schema-report.js after
// 20261111080000. Each leads with tenant_id where the table has one: every
// app query carries it under RLS. The identity link tables have no tenant.
// Audit links (who did it → app_user; the journal it made → ledger entry) are
// never searched from the parent and stay unindexed on purpose.

exports.shorthands = undefined;

const INDEXES = [
  ['ai', 'inbound_message', ['tenant_id', 'customer_id']], // → trading_partners.customer
  ['ai', 'inbound_message', ['tenant_id', 'recommendation_id']], // → ai.recommendation
  ['ai', 'recommendation', ['tenant_id', 'run_id']], // → ai.run
  ['ai', 'voice_call', ['tenant_id', 'order_id']], // → commerce.customer_order
  ['approvals', 'approval_delegation', ['tenant_id', 'role_id']], // → identity.role
  ['approvals', 'approval_request', ['tenant_id', 'decided_via_role_id']], // → identity.role
  ['approvals', 'approval_request', ['tenant_id', 'decided_via_delegation_id']], // → approvals.approval_delegation
  ['chat', 'read_marker', ['tenant_id', 'driver_employee_id']], // → trading_partners.employee
  ['commerce', 'customer_order', ['tenant_id', 'approval_request_id']], // → approvals.approval_request
  ['commerce', 'customer_order', ['tenant_id', 'planned_driver_id']], // → trading_partners.employee
  ['commerce', 'customer_order', ['tenant_id', 'planned_vehicle_id']], // → trading_partners.vehicle
  ['commerce', 'customer_order', ['tenant_id', 'route_id']], // → trading_partners.route
  ['commerce', 'customer_order_line', ['tenant_id', 'product_id']], // → trading_partners.product
  ['commerce', 'lot', ['tenant_id', 'farmer_id']], // → trading_partners.farmer
  ['commerce', 'lot', ['tenant_id', 'pickup_id']], // → commerce.pickup
  ['commerce', 'pickup', ['tenant_id', 'driver_employee_id']], // → trading_partners.employee
  ['commerce', 'pickup', ['tenant_id', 'farmer_id']], // → trading_partners.farmer
  ['commerce', 'pickup', ['tenant_id', 'vehicle_id']], // → trading_partners.vehicle
  ['commerce', 'purchase_order', ['tenant_id', 'agent_id']], // → trading_partners.agent
  ['commerce', 'purchase_order', ['tenant_id', 'approval_request_id']], // → approvals.approval_request
  ['commerce', 'purchase_order', ['tenant_id', 'planned_driver_id']], // → trading_partners.employee
  ['commerce', 'purchase_order', ['tenant_id', 'planned_vehicle_id']], // → trading_partners.vehicle
  ['commerce', 'purchase_order_line', ['tenant_id', 'product_id']], // → trading_partners.product
  ['crates', 'crate_loss', ['tenant_id', 'invoice_id']], // → money.invoice
  ['crates', 'movement', ['tenant_id', 'crate_type_id']], // → crates.crate_type
  ['crates', 'movement', ['tenant_id', 'trip_stop_id']], // → fulfilment.trip_stop
  ['crates', 'payable_deduction', ['tenant_id', 'loss_id']], // → crates.crate_loss
  ['fleet', 'depreciation_entry', ['tenant_id', 'run_id']], // → fleet.depreciation_run
  ['fleet', 'fuel_log', ['tenant_id', 'trip_id']], // → fulfilment.trip
  ['fleet', 'hire_bill', ['tenant_id', 'contract_id']], // → fleet.hire_contract
  ['fleet', 'vehicle_loan', ['tenant_id', 'vehicle_id']], // → trading_partners.vehicle
  ['fulfilment', 'delivery_line_measure', ['tenant_id', 'product_id']], // → trading_partners.product
  ['fulfilment', 'delivery_shortfall', ['tenant_id', 'order_line_id']], // → commerce.customer_order_line
  ['fulfilment', 'driver_request', ['tenant_id', 'customer_id']], // → trading_partners.customer
  ['fulfilment', 'driver_request', ['tenant_id', 'trip_id']], // → fulfilment.trip
  ['fulfilment', 'farm_stop_line', ['tenant_id', 'lot_id']], // → commerce.lot
  ['fulfilment', 'farm_stop_line', ['tenant_id', 'product_id']], // → trading_partners.product
  ['fulfilment', 'trip', ['tenant_id', 'loader_employee_id']], // → trading_partners.employee
  ['fulfilment', 'trip', ['tenant_id', 'packer_employee_id']], // → trading_partners.employee
  ['fulfilment', 'trip', ['tenant_id', 'route_id']], // → trading_partners.route
  ['fulfilment', 'trip_stop', ['tenant_id', 'loader_employee_id']], // → trading_partners.employee
  ['fulfilment', 'trip_stop', ['tenant_id', 'order_id']], // → commerce.customer_order
  ['fulfilment', 'trip_stop', ['tenant_id', 'packer_employee_id']], // → trading_partners.employee
  ['fulfilment', 'trip_stop', ['tenant_id', 'pickup_id']], // → commerce.pickup
  ['fulfilment', 'trip_stop_photo', ['tenant_id', 'product_id']], // → trading_partners.product
  ['identity', 'role_permission', ['permission_id']], // → identity.permission
  ['identity', 'user_role', ['role_id']], // → identity.role
  ['money', 'invoice', ['tenant_id', 'source_invoice_id']], // → money.invoice
  ['money', 'invoice_dispute', ['tenant_id', 'customer_id']], // → trading_partners.customer
  ['money', 'invoice_line', ['tenant_id', 'order_line_id']], // → commerce.customer_order_line
  ['money', 'invoice_line', ['tenant_id', 'product_id']], // → trading_partners.product
  ['spot', 'spot_sale', ['tenant_id', 'approval_request_id']], // → approvals.approval_request
  ['spot', 'spot_sale', ['tenant_id', 'driver_employee_id']], // → trading_partners.employee
  ['spot', 'spot_sale', ['tenant_id', 'invoice_id']], // → money.invoice
  ['spot', 'spot_sale', ['tenant_id', 'payment_id']], // → money.customer_payment
  ['spot', 'spot_sale_line', ['tenant_id', 'product_id']], // → trading_partners.product
  ['spot', 'spot_sale_lot', ['tenant_id', 'lot_id']], // → commerce.lot
  ['stock', 'inventory_movement', ['tenant_id', 'from_location_id']], // → stock.location
  ['stock', 'inventory_movement', ['tenant_id', 'to_location_id']], // → stock.location
  ['stock', 'location', ['tenant_id', 'vehicle_id']], // → trading_partners.vehicle
  ['tax', 'invoice_line_tax', ['tenant_id', 'rule_id']], // → tax.gst_rate
  ['tax', 'tds_deduction', ['tenant_id', 'challan_id']], // → tax.tds_challan
  ['tax', 'tds_deduction', ['tenant_id', 'section_id']], // → tax.tds_section
  ['tenant', 'owner_alert', ['tenant_id', 'trip_id']], // → fulfilment.trip
  ['workforce', 'assignment', ['tenant_id', 'settlement_id']], // → workforce.settlement
  ['workforce', 'assignment', ['tenant_id', 'trip_id']], // → fulfilment.trip
  ['workforce', 'settlement_line', ['tenant_id', 'incentive_rule_id']], // → workforce.incentive_rule
  ['workforce', 'trip_incentive', ['tenant_id', 'settlement_id']], // → workforce.settlement
];

exports.up = (pgm) => {
  for (const [schema, name, columns] of INDEXES) pgm.createIndex({ schema, name }, columns);
};

exports.down = (pgm) => {
  for (const [schema, name, columns] of [...INDEXES].reverse()) pgm.dropIndex({ schema, name }, columns);
};
