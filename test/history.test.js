import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { useTestApp } from './helpers.js';

const t = useTestApp();

describe('transaction history', () => {
  let u;
  before(async () => {
    u = await t.user();
    for (let i = 1; i <= 7; i++) await t.tx(u, 'credit', i * 10, `c${i}`);
    for (let i = 1; i <= 3; i++) await t.tx(u, 'debit', i, `d${i}`);
  });

  test('latest first', async () => {
    const { data } = await t.history(u);
    assert.deepEqual(data.map((x) => x.reference_id), ['d3', 'd2', 'd1', 'c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1']);
    const stamps = data.map((x) => x.created_at);
    assert.deepEqual(stamps, [...stamps].sort().reverse());
  });

  test('filter by type; no type returns both', async () => {
    const credits = await t.history(u, { type: 'credit' });
    const debits = await t.history(u, { type: 'debit' });
    assert.ok(credits.data.every((x) => x.type === 'credit'));
    assert.ok(debits.data.every((x) => x.type === 'debit'));
    assert.equal(credits.pagination.total_records, 7);
    assert.equal(debits.pagination.total_records, 3);
    assert.equal((await t.history(u)).pagination.total_records, 10);
  });

  test('pagination', async () => {
    const p1 = await t.history(u, { page: 1, limit: 4 });
    assert.deepEqual(p1.pagination, { page: 1, limit: 4, total_records: 10, total_pages: 3 });
    assert.equal(p1.data.length, 4);
    assert.equal((await t.history(u, { page: 3, limit: 4 })).data.length, 2);
    const ids = [];
    for (const page of [1, 2, 3]) ids.push(...(await t.history(u, { page, limit: 4 })).data.map((x) => x.id));
    assert.equal(new Set(ids).size, 10);
    const beyond = await t.history(u, { page: 9, limit: 4 });
    assert.deepEqual(beyond.data, []);
    assert.equal(beyond.pagination.total_pages, 3);
  });

  test('filter + pagination together', async () => {
    const r = await t.history(u, { type: 'credit', page: 2, limit: 5 });
    assert.deepEqual(r.data.map((x) => x.reference_id), ['c2', 'c1']);
    assert.equal(r.pagination.total_pages, 2);
  });

  test('defaults and empty history', async () => {
    assert.deepEqual(await t.history(await t.user()), {
      data: [], pagination: { page: 1, limit: 20, total_records: 0, total_pages: 0 },
    });
  });

  for (const q of [{ page: 0 }, { page: -1 }, { page: 'x' }, { limit: 0 }, { limit: 101 }, { limit: '1.5' }]) {
    test(`invalid pagination ${JSON.stringify(q)}`, async () => {
      const res = await t.api().get('/me/transactions').set(u.auth).query(q);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_PAGINATION');
    });
  }

  test('invalid type filter', async () => {
    const res = await t.api().get('/me/transactions').set(u.auth).query({ type: 'refund' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_TRANSACTION_TYPE');
  });
});
