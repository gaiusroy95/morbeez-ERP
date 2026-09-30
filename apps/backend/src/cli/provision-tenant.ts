import { NestFactory } from '@nestjs/core';
import { randomBytes } from 'crypto';
import { AppModule } from '../app.module';
import { TenantService } from '../modules/tenant/tenant.service';

// Creates a business and its owner — how the team onboards each pilot
// customer while public signup is off (SIGNUP_ENABLED). The same path
// signup takes: tenant, chart of accounts, Owner role, owner login, in one
// transaction. Run it as a one-off task on the API image:
//
//   node dist/src/cli/provision-tenant.js "Sharma Vegetables" owner@sharmaveg.in
//
// It prints a one-time password once. Give it to the owner by phone, not
// email or chat, and have them change it at first sign-in (Your account →
// Change password), which also ends the session it was used for.

async function main(): Promise<void> {
  const [businessName, ownerEmail] = process.argv.slice(2).map((a) => a?.trim());
  if (!businessName || !ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    console.error('Usage: provision-tenant "<business name>" <owner email>');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const password = randomBytes(12).toString('base64url'); // 16 characters
    const { tenant, owner } = await app.get(TenantService).createBusinessAccount(businessName, ownerEmail, password);
    console.log(
      JSON.stringify({
        tenantId: tenant.id,
        business: tenant.name,
        ownerEmail: owner.email,
        oneTimePassword: password,
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error(`Could not create the business: ${err.message}`);
  process.exit(1);
});
