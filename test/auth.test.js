import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { useTestApp } from './helpers.js';

const t = useTestApp();
const signup = (over = {}) => t.api().post('/auth/signup')
  .send({ name: 'Alice', username: `alice${Math.random().toString(36).slice(2, 7)}`, password: 's3cret-pass', ...over });

describe('signup (create account)', () => {
  test('creates an account with balance 0 and returns a token', async () => {
    const res = await signup({ name: '  Alice  ', username: 'Alice_One' });
    assert.equal(res.status, 201);
    const { account, access_token, token_type } = res.body;
    assert.equal(token_type, 'bearer');
    assert.ok(access_token);
    assert.equal(account.name, 'Alice');
    assert.equal(account.username, 'alice_one');
    assert.equal(account.balance, 0);
    assert.match(account.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(account.created_at)));
    assert.ok(!JSON.stringify(res.body).includes('password'));

    const me = await t.api().get('/me').set('Authorization', `Bearer ${access_token}`);
    assert.equal(me.body.id, account.id);
  });

  test('ids are unique', async () => {
    const ids = new Set();
    for (let i = 0; i < 10; i++) ids.add((await t.user(`u${i}`)).id);
    assert.equal(ids.size, 10);
  });

  test('client cannot set balance, id or created_at', async () => {
    for (const extra of [{ balance: 500 }, { id: 'x' }, { created_at: '2020-01-01' }]) {
      const res = await signup(extra);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.match(res.body.error.details[0].message, /unknown field/);
    }
  });

  for (const [over, field] of [
    [{ name: '' }, 'name'], [{ name: '   ' }, 'name'], [{ name: null }, 'name'], [{ name: undefined }, 'name'],
    [{ username: 'ab' }, 'username'], [{ username: 'has space' }, 'username'], [{ password: 'short' }, 'password'],
  ]) {
    test(`rejects invalid ${field}: ${JSON.stringify(over)}`, async () => {
      const res = await signup(over);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.details[0].field, field);
    });
  }

  test('usernames are unique, case-insensitively', async () => {
    assert.equal((await signup({ username: 'bob' })).status, 201);
    const res = await signup({ username: 'BOB' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'USERNAME_TAKEN');
  });

  test('malformed or non-object bodies', async () => {
    for (const body of ['{not json', '[1,2]', '"str"']) {
      const res = await t.api().post('/auth/signup').set('Content-Type', 'application/json').send(body);
      assert.equal(res.status, 400, body);
      assert.equal(res.body.error.code, 'INVALID_REQUEST_BODY');
    }
    const empty = await t.api().post('/auth/signup');
    assert.equal(empty.body.error.code, 'INVALID_REQUEST_BODY');
  });
});

describe('login / logout / tokens', () => {
  test('login returns a working token', async () => {
    const created = (await signup({ username: 'carol' })).body.account;
    const res = await t.api().post('/auth/login').send({ username: 'Carol', password: 's3cret-pass' });
    assert.equal(res.status, 200);
    assert.equal(res.body.account.id, created.id);
    const me = await t.api().get('/me').set('Authorization', `Bearer ${res.body.access_token}`);
    assert.equal(me.status, 200);
  });

  test('wrong password and unknown user fail the same way', async () => {
    await signup({ username: 'dave' });
    for (const creds of [{ username: 'dave', password: 'wrong-pass' }, { username: 'nobody', password: 's3cret-pass' }]) {
      const res = await t.api().post('/auth/login').send(creds);
      assert.equal(res.status, 401);
      assert.deepEqual(res.body.error, { code: 'INVALID_CREDENTIALS', message: 'Incorrect username or password' });
    }
  });

  for (const header of [undefined, 'Bearer nope', 'Basic abc', 'Bearer']) {
    test(`/me routes need a valid token (${header ?? 'none'})`, async () => {
      for (const [method, path] of [['get', '/me'], ['get', '/me/balance'], ['get', '/me/transactions'],
        ['post', '/me/transactions'], ['post', '/me/transfers']]) {
        let req = t.api()[method](path);
        if (header) req = req.set('Authorization', header);
        const res = await req.send({});
        assert.equal(res.status, 401, `${method} ${path}`);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
      }
    });
  }

  test('logout revokes the token', async () => {
    const u = await t.user();
    assert.equal((await t.api().post('/auth/logout').set(u.auth)).status, 204);
    assert.equal((await t.api().get('/me').set(u.auth)).status, 401);
  });

  test('expired tokens are rejected', async () => {
    const u = await t.user();
    await t.db.query("UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE account_id = $1", [u.id]);
    assert.equal((await t.api().get('/me').set(u.auth)).status, 401);
  });

  test('passwords and tokens are stored hashed', async () => {
    const u = await t.user();
    const { rows: [a] } = await t.db.query('SELECT password_hash FROM accounts WHERE id = $1', [u.id]);
    assert.match(a.password_hash, /^scrypt\$/);
    const { rows } = await t.db.query('SELECT token_hash FROM auth_tokens WHERE account_id = $1', [u.id]);
    assert.ok(rows.every((r) => r.token_hash.length === 64 && r.token_hash !== u.token));
  });

  test('there are no public, id-based account routes', async () => {
    const u = await t.user('A', 10);
    for (const path of [`/accounts/${u.id}`, `/accounts/${u.id}/balance`, '/accounts', '/transactions']) {
      assert.equal((await t.api().get(path)).status, 404);
    }
  });
});
