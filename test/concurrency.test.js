import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { useTestApp } from './helpers.js';

const t = useTestApp();

describe('concurrency', () => {
  test('40 parallel debits of 7 against 100: exactly 14 succeed, balance never negative', async () => {
    const u = await t.user('A', 100);
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => t.tx(u, 'debit', 7, `d${i}`)));
    const codes = results.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 201).length, 14);
    assert.equal(codes.filter((c) => c === 422).length, 26);
    assert.equal(await t.balance(u), 2);
  });

  test('20 parallel identical requests create exactly one transaction', async () => {
    const u = await t.user('A', 100);
    const results = await Promise.all(Array.from({ length: 20 }, () => t.tx(u, 'credit', 5, 'same')));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.every((r) => r.status === 201 || r.body.error.code === 'DUPLICATE_TRANSACTION'));
    assert.equal(await t.balance(u), 105);
  });

  test('opposite transfers in parallel: no deadlock, money is conserved, balances match history', async () => {
    const [a, b] = [await t.user('A', 100), await t.user('B', 100)];
    await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2
      ? t.transfer(a, b.id, 3, `t${i}`) : t.transfer(b, a.id, 3, `t${i}`))));
    const [ba, bb] = [await t.balance(a), await t.balance(b)];
    assert.equal(ba + bb, 200);
    for (const [u, bal] of [[a, ba], [b, bb]]) {
      const { data } = await t.history(u, { limit: 100 });
      const net = data.reduce((s, x) => s + (x.type === 'credit' ? x.amount : -x.amount), 0);
      assert.equal(Math.round(net * 100) / 100, bal);
    }
  });
});
