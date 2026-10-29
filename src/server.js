import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';

await migrate(pool);
const server = createApp(pool).listen(config.port, () => {
  console.log(`Ledger API on http://127.0.0.1:${config.port} (docs at /docs)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
}
