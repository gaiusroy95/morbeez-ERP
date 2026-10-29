#!/usr/bin/env node
// Empties the e2e Redis along with the database, so one chain's rate-limit
// counters (10 signups an hour per network, sign-in attempts) don't refuse
// the next chain's requests. Only a Redis on this machine is ever flushed.
const path = require('path');
const url = process.env.REDIS_URL;
if (!url) process.exit(0);
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error(`reset-redis: refusing to flush ${host} — not a local Redis`);
  process.exit(1);
}
const Redis = require(require.resolve('ioredis', { paths: [path.resolve(__dirname, '../../apps/backend')] }));
const redis = new Redis(url, { maxRetriesPerRequest: 1 });
redis
  .flushdb()
  .then(() => redis.quit())
  .catch((err) => {
    console.error(`reset-redis: ${err.message}`);
    process.exit(1);
  });
