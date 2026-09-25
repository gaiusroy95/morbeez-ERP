import { readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

// Seeds synthetic dev/test fixture data only — never real tenant data
// (Constitution VI.5). Each seed file in this directory exports a
// `seed(client)` function and is run in filename order (numeric prefix),
// so a later seed can depend on an earlier one's rows.

const DATABASE_URL = process.env.DATABASE_URL;

function assertNotProduction() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to run seeds with NODE_ENV=production. Seeds insert ' +
        'synthetic data and must never touch a production database ' +
        '(Constitution VI.5).',
    );
  }
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }
}

async function main() {
  assertNotProduction();

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const seedFiles = readdirSync(__dirname)
    .filter((f) => /^\d+_.*\.ts$/.test(f))
    .sort();

  try {
    for (const file of seedFiles) {
      const mod = await import(join(__dirname, file));
      if (typeof mod.seed !== 'function') {
        throw new Error(`${file} does not export a seed(client) function`);
      }
      console.log(`Seeding: ${file}`);
      await mod.seed(client);
    }
    console.log(`Done — ${seedFiles.length} seed file(s) applied.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
