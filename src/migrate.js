import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Apply every migrations/*.sql in order. Each file is idempotent, so re-running is safe. */
export async function migrate(db = pool) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.query(await readFile(path.join(dir, file), 'utf8'));
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then((files) => console.log(`Applied: ${files.join(', ')}`))
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
