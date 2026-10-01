import { NestFactory } from '@nestjs/core';
import { randomBytes } from 'crypto';
import { AppModule } from '../app.module';
import { TenantService } from '../modules/tenant/tenant.service';
import { TRIAL_DAYS } from '../modules/tenant/entities/tenant.entity';
import { normalizeIndianMobile } from '../common/phone';

// Creates a business and its owner — how the team onboards a customer
// by hand. The same path signup takes: tenant, chart of accounts, Owner
// role, owner login, in one transaction, with the same free trial unless
// --no-trial (a business on its own terms; set-subscription records
// payment later). Run it as a one-off task on the API image:
//
//   node dist/src/cli/provision-tenant.js "Sharma Vegetables" 98220 11111
//   node dist/src/cli/provision-tenant.js "Sharma Vegetables" "98220 11111" --no-trial
//
// It prints a one-time password once. Give it to the owner by phone, not
// email or chat, and have them change it at first sign-in (Your account →
// Change password), which also ends the session it was used for.

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const noTrial = args.includes('--no-trial');
  const [businessName, ...phoneParts] = args.filter((a) => a !== '--no-trial').map((a) => a.trim());
  const ownerPhone = normalizeIndianMobile(phoneParts.join(''));
  if (!businessName || !ownerPhone) {
    console.error('Usage: provision-tenant "<business name>" <owner mobile number> [--no-trial]');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const password = randomBytes(12).toString('base64url'); // 16 characters
    const { tenant, owner } = await app
      .get(TenantService)
      .createBusinessAccount(businessName, { phone: ownerPhone }, password, noTrial ? null : TRIAL_DAYS);
    console.log(
      JSON.stringify({
        tenantId: tenant.id,
        business: tenant.name,
        ownerPhone: owner.phone,
        trialEndsAt: tenant.trialEndsAt,
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
