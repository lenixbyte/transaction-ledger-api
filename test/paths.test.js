import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTestApp } from './helpers.js';

const t = useTestApp();

test('the API is also served under /api, with matching Swagger servers', async () => {
  const signup = await t.api().post('/api/auth/signup').send({ name: 'P', username: 'pathuser', password: 's3cret-pass' });
  assert.equal(signup.status, 201);
  const me = await t.api().get('/api/me/balance').set('Authorization', `Bearer ${signup.body.access_token}`);
  assert.equal(me.body.balance, 0);
  assert.deepEqual((await t.api().get('/api/openapi.json')).body.servers, [{ url: '/api' }]);
  assert.deepEqual((await t.api().get('/openapi.json')).body.servers, [{ url: '/' }]);
  assert.equal((await t.api().get('/api/docs/')).status, 200);
  assert.equal((await t.api().get('/api')).headers.location, '/api/docs');
  assert.equal((await t.api().get('/')).headers.location, '/docs');
});
