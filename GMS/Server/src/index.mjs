import './config.mjs';
import { createPool } from './database.mjs';
import { createApp } from './app.mjs';
import { maintenance } from './maintenance.mjs';
const pool = createPool(process.env.DATABASE_URL),
  production = process.env.NODE_ENV === 'production';
const number = (name, fallback) => {
  const n = Number(process.env[name] || fallback);
  if (!Number.isInteger(n) || n < 1 || n > 1440)
    throw new Error('Invalid ' + name);
  return n;
};
const options = {
  production,
  trustProxy: process.env.TRUST_PROXY === '1',
  origin: process.env.APP_ORIGIN,
  idleMinutes: number('IDLE_MINUTES', 15),
  lockMinutes: number('LOCK_MINUTES', 15),
  autoCheckout: process.env.AUTO_CHECKOUT === 'true',
  expiryPolicyApproved: process.env.EXPIRY_POLICY_APPROVED === 'true',
  onError: (e) => console.error('Server operation failed:', e.code || e.name),
};
if (
  production &&
  (!options.origin?.startsWith('https://') || !options.expiryPolicyApproved)
)
  throw new Error(
    'Production requires an HTTPS APP_ORIGIN and client-approved expiry policy (EXPIRY_POLICY_APPROVED=true).',
  );
const app = await createApp(pool, options);
const server = app.listen(
  Number(process.env.PORT || 8000),
  process.env.HOST || '127.0.0.1',
  () =>
    console.log(
      'Gym Management System: http://localhost:' + (process.env.PORT || 8000),
    ),
);
const timer = setInterval(
  () =>
    maintenance(pool, options).catch((e) =>
      console.error('Maintenance failed:', e.code || e.name),
    ),
  60000,
);
timer.unref();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => pool.end());
  });
