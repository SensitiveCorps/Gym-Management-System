import pg from 'pg';
pg.types.setTypeParser(1082, (value) => value);
export function createPool(connectionString) {
  if (!connectionString)
    throw new Error('Set DATABASE_URL before starting the server.');
  return new pg.Pool({
    connectionString,
    max: 10,
    options: '-c timezone=Africa/Mbabane',
    connectionTimeoutMillis: 5000,
  });
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'Africa/Mbabane'");
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function rows(db, sql, args = []) {
  return (await db.query(sql, args)).rows;
}
export async function one(db, sql, args = []) {
  return (await rows(db, sql, args))[0];
}
