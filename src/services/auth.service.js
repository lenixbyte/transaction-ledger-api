import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { errors, PG_UNIQUE_VIOLATION } from '../errors.js';
import { accountOut } from './ledger.service.js';

// Passwords: salted scrypt (built into Node, no native dependency).
const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), 32, SCRYPT);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// Tokens: 256 random bits handed to the client; only their SHA-256 is stored, so a leaked
// database does not leak usable tokens. Revocable (logout) and expiring.
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function issueToken(db, account) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.tokenTtlHours * 3600_000);
  await db.query('INSERT INTO auth_tokens (token_hash, account_id, expires_at) VALUES ($1, $2, $3)',
    [sha256(token), account.id, expiresAt]);
  return { access_token: token, token_type: 'bearer', expires_at: expiresAt.toISOString(), account: accountOut(account) };
}

/** Create the account (balance always 0) with its login, and log it in. */
export async function signup(db, { name, username, password }) {
  const passwordHash = await hashPassword(password);
  try {
    return await withTransaction(db, async (client) => {
      const { rows } = await client.query(
        'INSERT INTO accounts (name, username, password_hash) VALUES ($1, $2, $3) RETURNING *',
        [name, username, passwordHash]);
      return issueToken(client, rows[0]);
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) throw errors.usernameTaken(username);
    throw err;
  }
}

let dummyHash;

export async function login(db, { username, password }) {
  const { rows } = await db.query('SELECT * FROM accounts WHERE username = $1', [username]);
  const account = rows[0];
  if (!account) {
    // Spend the same time as a real check so response timing does not reveal valid usernames.
    dummyHash ??= await hashPassword('not-a-real-password');
    await verifyPassword(password, dummyHash);
    throw errors.invalidCredentials();
  }
  if (!(await verifyPassword(password, account.password_hash))) throw errors.invalidCredentials();
  return issueToken(db, account);
}

/** Resolve a bearer token to its account id, or throw 401. */
export async function accountIdForToken(db, token) {
  const { rows } = await db.query(
    'SELECT account_id FROM auth_tokens WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
  if (!rows[0]) throw errors.unauthorized();
  return rows[0].account_id;
}

export async function logout(db, token) {
  await db.query('DELETE FROM auth_tokens WHERE token_hash = $1', [sha256(token)]);
}
