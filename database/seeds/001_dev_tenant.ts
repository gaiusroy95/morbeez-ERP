import { Client } from 'pg';

// Proves the migrate → seed pipeline end to end. A real fixture catalog
// (customers, farmers, products, orders...) is added as each bounded
// context's tables are implemented — this is deliberately the only seed
// for now.
//
// Idempotent by name, not by a unique constraint the tenant table doesn't
// have — re-running this seed against a database that already has it is a
// no-op, not a duplicate row.
export async function seed(client: Client): Promise<void> {
  const { rows } = await client.query(
    `SELECT 1 FROM tenant.tenant WHERE name = $1 LIMIT 1`,
    ['Dev Wholesaler Co.'],
  );
  if (rows.length > 0) return;

  await client.query(
    `INSERT INTO tenant.tenant (name, plan, currency, timezone)
     VALUES ($1, $2, $3, $4)`,
    ['Dev Wholesaler Co.', 'standard', 'INR', 'Asia/Kolkata'],
  );
}
