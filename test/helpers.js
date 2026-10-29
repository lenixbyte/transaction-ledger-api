import { after, before } from 'node:test';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';

const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:test@127.0.0.1:55450/ledger_test';

/**
 * Each test file gets its own throwaway schema in the test database, with migrations applied,
 * so files never see each other's data. Returns helpers bound to that app.
 */
export function useTestApp() {
  const schema = `t_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const ctx = {};
  let admin;

  before(async () => {
    admin = new pg.Pool({ connectionString: TEST_DB, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    ctx.db = new pg.Pool({ connectionString: TEST_DB, options: `-c search_path=${schema}`, max: 20 });
    await migrate(ctx.db);
    ctx.app = createApp(ctx.db);
  });

  after(async () => {
    await ctx.db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  let n = 0;
  ctx.api = () => request(ctx.app);

  /** Sign up a fresh user (optionally funded). Returns the account plus an auth header. */
  ctx.user = async (name = 'Alice', balance = 0) => {
    const username = `user${++n}_${Math.random().toString(36).slice(2, 6)}`;
    const res = await request(ctx.app).post('/auth/signup').send({ name, username, password: 's3cret-pass' });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
    const u = { ...res.body.account, token: res.body.access_token, auth: { Authorization: `Bearer ${res.body.access_token}` } };
    if (balance) {
      const r = await ctx.tx(u, 'credit', balance, 'seed');
      if (r.status !== 201) throw new Error('seed failed');
    }
    return u;
  };

  ctx.tx = (u, type, amount, reference_id, extra = {}) =>
    request(ctx.app).post('/me/transactions').set(u.auth).send({ type, amount, reference_id, ...extra });

  ctx.transfer = (u, to_account_id, amount, reference_id = 't1', extra = {}) =>
    request(ctx.app).post('/me/transfers').set(u.auth).send({ to_account_id, amount, reference_id, ...extra });

  ctx.balance = async (u) => (await request(ctx.app).get('/me/balance').set(u.auth)).body.balance;

  ctx.history = async (u, query = {}) => (await request(ctx.app).get('/me/transactions').set(u.auth).query(query)).body;

  return ctx;
}
