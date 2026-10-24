import '../src/config.mjs';
import { readFile } from 'node:fs/promises';
import { createPool, transaction } from '../src/database.mjs';
const pool = createPool(process.env.DATABASE_URL);
try {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS gms_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  );
  const initialized = (
    await pool.query("SELECT to_regclass('public.members') IS NOT NULL AS yes")
  ).rows[0].yes;
  const applied = (
    await pool.query('SELECT name FROM gms_migrations')
  ).rows.map((x) => x.name);
  for (const name of [
    '01_schema.sql',
    '02_logic_and_views.sql',
    '04_application.sql',
    '05_workflow_fixes.sql',
    '06_payment_previews.sql',
  ]) {
    if (
      applied.includes(name) ||
      (initialized &&
        ['01_schema.sql', '02_logic_and_views.sql'].includes(name))
    )
      continue;
    const sql = (
      await readFile(
        new URL('../../database/' + name, import.meta.url),
        'utf8',
      )
    )
      .replace(/^BEGIN;\s*$/gm, '')
      .replace(/^COMMIT;\s*$/gm, '');
    await transaction(pool, async (db) => {
      await db.query(sql);
      await db.query('INSERT INTO gms_migrations(name) VALUES($1)', [name]);
    });
    console.log('Applied ' + name);
  }
} finally {
  await pool.end();
}
