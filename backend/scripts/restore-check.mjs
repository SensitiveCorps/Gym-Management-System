import '../src/config.mjs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPool } from '../src/database.mjs';
import { pgEnvironment } from './backup.mjs';
const target = process.env.RESTORE_DATABASE_URL;
if (!target || target === process.env.DATABASE_URL)
  throw new Error(
    'Set RESTORE_DATABASE_URL to a separate, empty, disposable PostgreSQL database.',
  );
if (!process.argv[2]) throw new Error('Pass the backup .dump path.');
const source = process.env.DATABASE_URL
    ? pgEnvironment(process.env.DATABASE_URL)
    : null,
  env = pgEnvironment(target);
if (
  source &&
  ['PGHOST', 'PGPORT', 'PGDATABASE'].every((k) => source[k] === env[k])
)
  throw new Error(
    'The restore target must be separate from the application database.',
  );
const pool = createPool(target);
try {
  if (
    Number(
      (
        await pool.query(
          "SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].n,
    ) !== 0
  )
    throw new Error('Restore target is not empty. No restore was attempted.');
  const result = spawnSync(
    'pg_restore',
    [
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '--dbname',
      env.PGDATABASE,
      resolve(process.argv[2]),
    ],
    { env, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
  );
  if (result.error) throw new Error('pg_restore is unavailable.');
  if (result.status !== 0)
    throw new Error('Restore failed: ' + result.stderr.trim());
  const resultCounts = (
    await pool.query(
      'SELECT (SELECT COUNT(*) FROM members) AS members,(SELECT COUNT(*) FROM payments) AS payments,(SELECT COUNT(*) FROM checkins) AS visits,(SELECT COUNT(*) FROM denied_attempts) AS denials,(SELECT COUNT(*) FROM members WHERE photo_bytes IS NOT NULL) AS protected_photos',
    )
  ).rows[0];
  console.log('Restore completed in the separate test database:', resultCounts);
} finally {
  await pool.end();
}
