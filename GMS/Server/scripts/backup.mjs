import '../src/config.mjs';
import { mkdir, chmod, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function pgEnvironment(connectionString) {
  if (!connectionString)
    throw new Error('A PostgreSQL connection URL is required.');
  const u = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(u.protocol))
    throw new Error('Use a PostgreSQL connection URL.');
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    ...(u.searchParams.has('sslmode')
      ? { PGSSLMODE: u.searchParams.get('sslmode') }
      : {}),
  };
}
export async function backup(connectionString, directory = 'backups') {
  const env = pgEnvironment(connectionString),
    folder = resolve(directory);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const filename = resolve(
    folder,
    'gms-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump',
  );
  const result = spawnSync(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl', '--file', filename],
    { env, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' },
  );
  if (result.error)
    throw new Error(
      'pg_dump is unavailable. Install PostgreSQL command-line tools and add them to PATH.',
    );
  if (result.status !== 0)
    throw new Error('Backup failed: ' + result.stderr.trim());
  await chmod(filename, 0o600);
  if (!(await stat(filename)).size) throw new Error('The backup is empty.');
  return filename;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(
    await backup(process.env.DATABASE_URL, process.argv[2] || 'backups'),
  );
