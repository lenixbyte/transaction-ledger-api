import { errors } from '../errors.js';
import { accountIdForToken } from '../services/auth.service.js';

export function bearerToken(req) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw errors.unauthorized("Missing bearer token. Send 'Authorization: Bearer <token>'.");
  }
  return token;
}

/** Puts the logged-in account's id on req.accountId. Every /me route uses it instead of a URL id. */
export const requireAuth = (db) => async (req, _res, next) => {
  req.accountId = await accountIdForToken(db, bearerToken(req));
  next();
};
