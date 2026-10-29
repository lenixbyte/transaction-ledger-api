import pg from 'pg';
import { config } from './config.js';

// BIGINT (money in minor units, seq) arrives as a string by default; our values fit in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

const isLocal = (url) => /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

export function createPool(connectionString = config.databaseUrl) {
  const ssl = config.databaseSsl && !isLocal(connectionString) ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString, ssl, max: 10 });
}

export const pool = createPool();

/**
 * Run fn(client) inside one database transaction. Commits if fn resolves, rolls back if it
 * throws, so a balance change and its transaction row are always saved together or not at all.
 */
export async function withTransaction(db, fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
