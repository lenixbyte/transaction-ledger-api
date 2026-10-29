import { withTransaction } from '../db.js';
import { errors, PG_UNIQUE_VIOLATION } from '../errors.js';
import { isUuid, TRANSFER_REFERENCE_PREFIX } from '../validation.js';

// ---------- serialisers (minor units -> major units, Date -> ISO string) ----------

const major = (minor) => minor / 100;
const iso = (d) => new Date(d).toISOString();

export const accountOut = (a) => ({
  id: a.id, name: a.name, username: a.username, balance: major(a.balance), created_at: iso(a.created_at),
});

export const transactionOut = (t) => ({
  id: t.id, account_id: t.account_id, type: t.type, amount: major(t.amount), description: t.description,
  reference_id: t.reference_id, balance_after: major(t.balance_after), transfer_id: t.transfer_id,
  created_at: iso(t.created_at),
});

// ---------- accounts ----------

async function findAccount(db, accountId, { lock = false } = {}) {
  if (!isUuid(accountId)) throw errors.accountNotFound(accountId);
  const { rows } = await db.query(`SELECT * FROM accounts WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [accountId]);
  if (!rows[0]) throw errors.accountNotFound(accountId);
  return rows[0];
}

export async function getAccount(db, accountId) {
  return accountOut(await findAccount(db, accountId));
}

export async function getBalance(db, accountId) {
  const a = await findAccount(db, accountId);
  return { account_id: a.id, balance: major(a.balance), as_of: new Date().toISOString() };
}

// ---------- transactions ----------

/**
 * Change the balance and return the new value. For a debit the sufficiency check and the update
 * are one statement (WHERE balance >= amount), so two concurrent debits can never overdraw.
 */
async function applyToBalance(client, accountId, type, amount) {
  const sql = type === 'credit'
    ? 'UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING balance'
    : 'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance';
  const { rows } = await client.query(sql, [accountId, amount]);
  if (!rows[0]) {
    const { rows: cur } = await client.query('SELECT balance FROM accounts WHERE id = $1', [accountId]);
    throw errors.insufficientBalance({ balance: major(cur[0]?.balance ?? 0), requested: major(amount) });
  }
  return rows[0].balance;
}

async function findByReference(db, accountId, referenceId) {
  const { rows } = await db.query(
    'SELECT * FROM transactions WHERE account_id = $1 AND reference_id = $2', [accountId, referenceId]);
  return rows[0] ? transactionOut(rows[0]) : null;
}

/** Credit or debit an account. Balance update + transaction row commit together or not at all. */
export async function addTransaction(db, accountId, { type, amount, description, reference_id }) {
  try {
    return await withTransaction(db, async (client) => {
      // Row lock: requests for the same account are processed one at a time.
      await findAccount(client, accountId, { lock: true });
      const existing = await findByReference(client, accountId, reference_id);
      if (existing) throw errors.duplicateTransaction(existing);

      const balanceAfter = await applyToBalance(client, accountId, type, amount);
      const { rows } = await client.query(
        `INSERT INTO transactions (account_id, type, amount, description, reference_id, balance_after)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [accountId, type, amount, description, reference_id, balanceAfter]);
      return transactionOut(rows[0]);
    });
  } catch (err) {
    // Backstop: the UNIQUE (account_id, reference_id) constraint caught a duplicate.
    if (err.code === PG_UNIQUE_VIOLATION) {
      const existing = await findByReference(db, accountId, reference_id);
      if (existing) throw errors.duplicateTransaction(existing);
    }
    throw err;
  }
}

/** Only the owner can read a transaction; anyone else gets the same 404 as for a missing one. */
export async function getTransaction(db, accountId, transactionId) {
  if (!isUuid(transactionId)) throw errors.transactionNotFound(transactionId);
  const { rows } = await db.query(
    'SELECT * FROM transactions WHERE id = $1 AND account_id = $2', [transactionId, accountId]);
  if (!rows[0]) throw errors.transactionNotFound(transactionId);
  return transactionOut(rows[0]);
}

/** History, latest first, optionally filtered by type, paginated. */
export async function listTransactions(db, accountId, { type, page, limit }) {
  await findAccount(db, accountId);
  const params = [accountId];
  let where = 'account_id = $1';
  if (type) { params.push(type); where += ` AND type = $${params.length}`; }

  const { rows: [{ count }] } = await db.query(`SELECT count(*)::int AS count FROM transactions WHERE ${where}`, params);
  const { rows } = await db.query(
    `SELECT * FROM transactions WHERE ${where}
     ORDER BY created_at DESC, seq DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]);

  return {
    data: rows.map(transactionOut),
    pagination: { page, limit, total_records: count, total_pages: Math.ceil(count / limit) },
  };
}

// ---------- transfers ----------

/** Each side sees only its own leg, so the sender never learns the recipient's balance. */
async function transferOut(db, transfer, viewerId) {
  const { rows } = await db.query(
    'SELECT * FROM transactions WHERE transfer_id = $1 AND account_id = $2', [transfer.id, viewerId]);
  return {
    id: transfer.id,
    direction: viewerId === transfer.from_account_id ? 'sent' : 'received',
    from_account_id: transfer.from_account_id,
    to_account_id: transfer.to_account_id,
    amount: major(transfer.amount),
    description: transfer.description,
    reference_id: transfer.reference_id,
    created_at: iso(transfer.created_at),
    transaction: transactionOut(rows[0]),
  };
}

async function findTransfer(db, fromAccountId, referenceId) {
  const { rows } = await db.query(
    'SELECT * FROM transfers WHERE from_account_id = $1 AND reference_id = $2', [fromAccountId, referenceId]);
  return rows[0] ? transferOut(db, rows[0], fromAccountId) : null;
}

/**
 * Move money between two accounts. The transfer record, both balance changes and both
 * transaction rows are one database transaction: a failure anywhere rolls all of it back.
 */
export async function createTransfer(db, fromAccountId, { to_account_id, amount, description, reference_id }) {
  if (to_account_id === fromAccountId) {
    throw errors.validation([{ field: 'to_account_id', message: 'must be a different account' }],
      'You cannot transfer to your own account');
  }
  try {
    return await withTransaction(db, async (client) => {
      // Lock both accounts in a fixed (id) order so two opposite transfers cannot deadlock.
      for (const id of [fromAccountId, to_account_id].sort()) await findAccount(client, id, { lock: true });

      const existing = await findTransfer(client, fromAccountId, reference_id);
      if (existing) throw errors.duplicateTransfer(existing);

      const { rows: [transfer] } = await client.query(
        `INSERT INTO transfers (from_account_id, to_account_id, amount, description, reference_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [fromAccountId, to_account_id, amount, description, reference_id]);

      // Debit first: if the sender cannot cover it nothing else runs and everything rolls back.
      const legs = [[fromAccountId, 'debit'], [to_account_id, 'credit']];
      for (const [accountId, type] of legs) {
        const balanceAfter = await applyToBalance(client, accountId, type, amount);
        await client.query(
          `INSERT INTO transactions
             (account_id, type, amount, description, reference_id, balance_after, transfer_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [accountId, type, amount, description, `${TRANSFER_REFERENCE_PREFIX}${transfer.id}`,
            balanceAfter, transfer.id, transfer.created_at]);
      }
      return transferOut(client, transfer, fromAccountId);
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      const existing = await findTransfer(db, fromAccountId, reference_id);
      if (existing) throw errors.duplicateTransfer(existing);
    }
    throw err;
  }
}

/** Visible to the sender and the recipient only. */
export async function getTransfer(db, accountId, transferId) {
  if (!isUuid(transferId)) throw errors.transferNotFound(transferId);
  const { rows } = await db.query(
    'SELECT * FROM transfers WHERE id = $1 AND $2 IN (from_account_id, to_account_id)', [transferId, accountId]);
  if (!rows[0]) throw errors.transferNotFound(transferId);
  return transferOut(db, rows[0], accountId);
}
