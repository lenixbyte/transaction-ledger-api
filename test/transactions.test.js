import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { useTestApp } from './helpers.js';

const t = useTestApp();

describe('credit and debit', () => {
  test('credit increases the balance', async () => {
    const u = await t.user('A', 100);
    const res = await t.tx(u, 'credit', 50, 'c1', { description: 'salary' });
    assert.equal(res.status, 201);
    assert.equal(res.body.balance_after, 150);
    assert.equal(res.body.description, 'salary');
    assert.equal(res.body.account_id, u.id);
    assert.equal(await t.balance(u), 150);
  });

  test('debit decreases the balance', async () => {
    const u = await t.user('A', 100);
    assert.equal((await t.tx(u, 'debit', 30, 'd1')).status, 201);
    assert.equal(await t.balance(u), 70);
  });

  test('debit larger than the balance is rejected and not stored', async () => {
    const u = await t.user('A', 100);
    const res = await t.tx(u, 'debit', 150, 'd1');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');
    assert.equal(await t.balance(u), 100);
    assert.equal((await t.history(u)).pagination.total_records, 1);
    // The rejected reference is free to use later.
    assert.equal((await t.tx(u, 'debit', 100, 'd1')).status, 201);
  });

  test('debit of exactly the balance is allowed', async () => {
    const u = await t.user('A', 10);
    assert.equal((await t.tx(u, 'debit', 10, 'd')).status, 201);
    assert.equal(await t.balance(u), 0);
  });

  test("brief's consistency example ends at 100", async () => {
    const u = await t.user();
    for (const [i, [type, amt]] of [['credit', 100], ['credit', 50], ['debit', 30], ['debit', 20]].entries()) {
      assert.equal((await t.tx(u, type, amt, `r${i}`)).status, 201);
    }
    assert.equal((await t.tx(u, 'debit', 1000, 'fail')).status, 422);
    assert.equal(await t.balance(u), 100);
  });

  test('decimal amounts are exact (no float drift)', async () => {
    const u = await t.user();
    for (let i = 0; i < 10; i++) await t.tx(u, 'credit', 0.1, `r${i}`);
    await t.tx(u, 'debit', 0.3, 'd');
    assert.equal(await t.balance(u), 0.7);
  });
});

describe('duplicates (reference_id)', () => {
  test('same reference on the same account creates nothing and returns the original', async () => {
    const u = await t.user('A', 100);
    const first = (await t.tx(u, 'debit', 30, 'ref-1')).body;
    const res = await t.tx(u, 'debit', 30, 'ref-1');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_TRANSACTION');
    assert.equal(res.body.error.details.existing_transaction.id, first.id);
    assert.equal(await t.balance(u), 70);
    assert.equal((await t.history(u)).pagination.total_records, 2);
  });

  test('duplicate wins over insufficient balance on retry', async () => {
    const u = await t.user('A', 100);
    await t.tx(u, 'debit', 100, 'all');
    assert.equal((await t.tx(u, 'debit', 100, 'all')).status, 409);
  });

  test('same reference on different accounts is fine', async () => {
    const [a, b] = [await t.user('A'), await t.user('B')];
    assert.equal((await t.tx(a, 'credit', 10, 'shared')).status, 201);
    assert.equal((await t.tx(b, 'credit', 10, 'shared')).status, 201);
  });
});

describe('validation', () => {
  for (const amount of [0, -5, 'abc', null, true, 1.234, 'NaN', 'Infinity', 1e13, [1], {}, '1e3']) {
    test(`rejects amount ${JSON.stringify(amount)}`, async () => {
      const res = await t.tx(await t.user(), 'credit', amount, 'x');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_AMOUNT');
    });
  }

  test('accepts a numeric string amount', async () => {
    const res = await t.tx(await t.user(), 'credit', '12.50', 'x');
    assert.equal(res.status, 201);
    assert.equal(res.body.amount, 12.5);
  });

  for (const type of ['CREDIT', 'refund', '', null, 1]) {
    test(`rejects type ${JSON.stringify(type)}`, async () => {
      const res = await t.tx(await t.user(), type, 5, 'x');
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'INVALID_TRANSACTION_TYPE');
    });
  }

  test('reference_id is required', async () => {
    const u = await t.user();
    for (const ref of ['', '   ', null]) {
      const res = await t.tx(u, 'credit', 5, ref);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.details[0].field, 'reference_id');
    }
    const missing = await t.api().post('/me/transactions').set(u.auth).send({ type: 'credit', amount: 5 });
    assert.equal(missing.status, 400);
  });

  test("reference_id cannot use the reserved 'transfer:' prefix", async () => {
    assert.equal((await t.tx(await t.user(), 'credit', 5, 'transfer:abc')).status, 400);
  });

  test('account comes from the token, not the body', async () => {
    const [a, b] = [await t.user('A'), await t.user('B')];
    const res = await t.tx(a, 'credit', 5, 'x', { account_id: b.id });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].message, "unknown field 'account_id' is not allowed");
    assert.equal(await t.balance(b), 0);
  });
});

describe('privacy and immutability', () => {
  test("cannot read someone else's transaction", async () => {
    const [a, b] = [await t.user('A', 10), await t.user('B')];
    const tx = (await t.history(a)).data[0];
    const res = await t.api().get(`/me/transactions/${tx.id}`).set(b.auth);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'TRANSACTION_NOT_FOUND');
    assert.deepEqual((await t.api().get(`/me/transactions/${tx.id}`).set(a.auth)).body, tx);
  });

  test('unknown or malformed transaction id is 404', async () => {
    const u = await t.user();
    for (const id of ['nope', '00000000-0000-0000-0000-000000000000']) {
      assert.equal((await t.api().get(`/me/transactions/${id}`).set(u.auth)).status, 404);
    }
  });

  test('PUT/PATCH/DELETE on a transaction return 405 and change nothing', async () => {
    const u = await t.user('A', 10);
    const tx = (await t.history(u)).data[0];
    for (const m of ['put', 'patch', 'delete']) {
      const res = await t.api()[m](`/me/transactions/${tx.id}`).set(u.auth).send({ amount: 1 });
      assert.equal(res.status, 405);
      assert.equal(res.body.error.code, 'METHOD_NOT_ALLOWED');
    }
    assert.deepEqual((await t.api().get(`/me/transactions/${tx.id}`).set(u.auth)).body, tx);
  });

  test('the database itself refuses UPDATE/DELETE on transactions', async () => {
    const u = await t.user('A', 10);
    await assert.rejects(t.db.query('UPDATE transactions SET amount = 1 WHERE account_id = $1', [u.id]), /immutable/);
    await assert.rejects(t.db.query('DELETE FROM transactions WHERE account_id = $1', [u.id]), /immutable/);
    assert.equal(await t.balance(u), 10);
  });

  test('the database refuses a negative balance', async () => {
    const u = await t.user('A', 10);
    await assert.rejects(t.db.query('UPDATE accounts SET balance = -1 WHERE id = $1', [u.id]), /check constraint/);
  });
});
