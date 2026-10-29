import { z } from 'zod';
import { config } from './config.js';
import { errors } from './errors.js';

export const TRANSFER_REFERENCE_PREFIX = 'transfer:';

/**
 * amount: a JSON number (or numeric string) > 0 with at most 2 decimal places.
 * Converted to integer minor units (e.g. 12.34 -> 1234) so no float ever reaches the database.
 */
const amount = z.unknown().transform((value, ctx) => {
  const fail = (message) => { ctx.addIssue({ code: 'custom', message }); return z.NEVER; };
  if (typeof value !== 'number' && typeof value !== 'string') return fail('amount must be a number');
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) return fail('amount must be a number');
  if (Number(text) <= 0) return fail('amount must be greater than 0');
  if (Number(text) > config.maxAmount) return fail(`amount must not exceed ${config.maxAmount}`);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return fail('amount must have at most 2 decimal places');
  return Math.round(Number(text) * 100);
});

const text = (field, max, min = 1) => z
  .string({ error: `${field} must be a string` })
  .trim()
  .min(min, { error: `${field} is required` })
  .max(max, { error: `${field} must be at most ${max} characters` });

const referenceId = text('reference_id', 100).refine((v) => !v.startsWith(TRANSFER_REFERENCE_PREFIX), {
  error: `reference_id must not start with '${TRANSFER_REFERENCE_PREFIX}' (reserved for transfers)`,
});
const description = text('description', 255, 0).nullish().transform((v) => v || null);

export const schemas = {
  signup: z.strictObject({
    name: text('name', 100),
    username: text('username', 50, 3)
      .regex(/^[A-Za-z0-9_.-]+$/, { error: 'username may only contain letters, digits, _ . and -' })
      .transform((v) => v.toLowerCase()),
    password: z.string({ error: 'password must be a string' })
      .min(8, { error: 'password must be at least 8 characters' })
      .max(128, { error: 'password must be at most 128 characters' }),
  }),
  login: z.strictObject({
    username: text('username', 50).transform((v) => v.toLowerCase()),
    password: z.string({ error: 'password must be a string' }).min(1, { error: 'password is required' }),
  }),
  transaction: z.strictObject({
    type: z.enum(['credit', 'debit'], { error: "type must be 'credit' or 'debit'" }),
    amount,
    description,
    reference_id: referenceId,
  }),
  transfer: z.strictObject({
    to_account_id: text('to_account_id', 64),
    amount,
    description,
    reference_id: referenceId,
  }),
};

/** Validate a request body; throws an ApiError with field-level details on failure. */
export function parseBody(schema, body) {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw errors.invalidBody();
  }
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const details = result.error.issues.flatMap((issue) => issue.code === 'unrecognized_keys'
    ? issue.keys.map((k) => ({ field: k, message: `unknown field '${k}' is not allowed` }))
    : [{ field: issue.path.join('.') || null, message: issue.message }]);

  const typeIssue = result.error.issues.find((i) => i.path[0] === 'type');
  if (typeIssue) throw errors.invalidType(body.type);
  if (details.some((d) => d.field === 'amount')) throw errors.invalidAmount(details);
  throw errors.validation(details);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID.test(v);

/** page/limit query parameters: positive integers, limit capped. */
export function parsePagination(query) {
  const read = (name, fallback, max) => {
    const raw = query[name];
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) {
      throw errors.invalidPagination(name, raw, `'${name}' must be an integer`);
    }
    const n = Number(raw);
    if (n < 1 || (max && n > max)) {
      throw errors.invalidPagination(name, raw, max ? `'${name}' must be between 1 and ${max}` : `'${name}' must be 1 or greater`);
    }
    return n;
  };
  return { page: read('page', 1), limit: read('limit', config.defaultPageSize, config.maxPageSize) };
}

export function parseTypeFilter(query) {
  const t = query.type;
  if (t === undefined) return null;
  if (t !== 'credit' && t !== 'debit') throw errors.invalidType(t);
  return t;
}
