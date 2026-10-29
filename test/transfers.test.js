import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { useTestApp } from './helpers.js';

const t = useTestApp();

describe('transfers', () => {
  test("brief's example: A 100, B 50, send 30 -> A 70, B 80", async () => {
    const [a, b] = [await t.user('A', 100), await t.user('B', 50)];
    const res = await t.transfer(a, b.id, 30);
    assert.equal(res.status, 201);
    const tr = res.body;
    assert.equal(tr.direction, 'sent');
    assert.equal(tr.from_account_id, a.id);
    assert.equal(tr.to_account_id, b.id);
    assert.equal(tr.transaction.type, 'debit');
    assert.equal(tr.transaction.balance_after, 70);
    assert.deepEqual([await t.balance(a), await t.balance(b)], [70, 80]);

    assert.deepEqual((await t.api().get(`/me/transfers/${tr.id}`).set(a.auth)).body, tr);
    const seenByB = (await t.api().get(`/me/transfers/${tr.id}`).set(b.auth)).body;
    assert.equal(seenByB.direction, 'received');
    assert.equal(seenByB.transaction.balance_after, 80);
    assert.equal((await t.history(a, { type: 'debit' })).data[0].transfer_id, tr.id);
  });

  test("the sender never sees the recipient's balance", async () => {
    const [a, b] = [await t.user('A', 100), await t.user('B', 5000)];
    assert.ok(!JSON.stringify((await t.transfer(a, b.id, 30)).body).includes('5030'));
  });

  test('outsiders cannot see a transfer', async () => {
    const [a, b, c] = [await t.user('A', 100), await t.user('B'), await t.user('C')];
    const { id } = (await t.transfer(a, b.id, 30)).body;
    const res = await t.api().get(`/me/transfers/${id}`).set(c.auth);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'TRANSFER_NOT_FOUND');
  });

  test('insufficient balance: nothing moves', async () => {
    const [a, b] = [await t.user('A', 100), await t.user('B', 50)];
    const res = await t.transfer(a, b.id, 100.01);
    assert.equal(res.status, 422);
    assert.deepEqual([await t.balance(a), await t.balance(b)], [100, 50]);
    assert.equal((await t.history(b)).pagination.total_records, 1);
  });

  test('recipient must exist', async () => {
    const a = await t.user('A', 100);
    for (const to of ['ghost', '00000000-0000-0000-0000-000000000000']) {
      const res = await t.transfer(a, to, 10);
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'ACCOUNT_NOT_FOUND');
    }
    assert.equal(await t.balance(a), 100);
  });

  test('cannot transfer to yourself', async () => {
    const a = await t.user('A', 100);
    const res = await t.transfer(a, a.id, 10);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'to_account_id');
  });

  test('sender comes from the token; from_account_id is rejected', async () => {
    const [a, b] = [await t.user('A', 100), await t.user('B', 100)];
    const res = await t.transfer(b, b.id, 10, 'steal', { from_account_id: a.id });
    assert.equal(res.status, 400);
    assert.deepEqual([await t.balance(a), await t.balance(b)], [100, 100]);
  });

  test('duplicate transfer reference', async () => {
    const [a, b] = [await t.user('A', 100), await t.user('B')];
    const first = (await t.transfer(a, b.id, 10, 'same')).body;
    const res = await t.transfer(a, b.id, 10, 'same');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_TRANSFER');
    assert.equal(res.body.error.details.existing_transfer.id, first.id);
    assert.deepEqual([await t.balance(a), await t.balance(b)], [90, 10]);
  });

  test('a failure after the debit rolls the whole transfer back', async () => {
    const [a, b] = [await t.user('A', 100), await t.user('B', 50)];
    // Make the credit leg's INSERT fail, after the debit has already been applied in the same DB transaction.
    const realConnect = t.db.connect.bind(t.db);
    // pool.query() calls connect(callback) internally; only intercept the promise form used by withTransaction.
    const spy = mock.method(t.db, 'connect', async (...args) => {
      if (args.length) return realConnect(...args);
      const client = await realConnect();
      const realQuery = client.query.bind(client);
      client.query = (sql, params) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO transactions') && params?.[1] === 'credit') {
          return Promise.reject(new Error('disk on fire'));
        }
        return realQuery(sql, params);
      };
      client.release = ((release) => (...args) => { client.query = realQuery; return release(...args); })(client.release.bind(client));
      return client;
    });
    const res = await t.transfer(a, b.id, 30);
    spy.mock.restore();
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    assert.deepEqual([await t.balance(a), await t.balance(b)], [100, 50]);
    assert.equal((await t.history(a)).pagination.total_records, 1);
  });
});
