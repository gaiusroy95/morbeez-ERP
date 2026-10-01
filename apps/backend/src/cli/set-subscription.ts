import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TenantService } from '../modules/tenant/tenant.service';
import { accessOf } from '../modules/tenant/entities/tenant.entity';

// Records that a business has paid, until payments are taken in the app:
// writes are allowed again through the end of the given day (India time).
// "none" clears it. Run as a one-off task on the API image:
//
//   node dist/src/cli/set-subscription.js <tenant id> 2027-03-31
//   node dist/src/cli/set-subscription.js <tenant id> none

async function main(): Promise<void> {
  const [tenantId, untilArg] = process.argv.slice(2).map((a) => a?.trim());
  const until = untilArg === 'none' ? null : /^\d{4}-\d{2}-\d{2}$/.test(untilArg ?? '') ? new Date(`${untilArg}T23:59:59+05:30`) : undefined;
  if (!tenantId || until === undefined) {
    console.error('Usage: set-subscription <tenant id> <YYYY-MM-DD | none>');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const tenant = await app.get(TenantService).setSubscribedUntil(tenantId, until);
    console.log(JSON.stringify({ tenantId: tenant.id, business: tenant.name, subscribedUntil: tenant.subscribedUntil, access: accessOf(tenant).state }));
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  console.error(`Could not update the subscription: ${err.message}`);
  process.exit(1);
});
