import { ApiError, errors } from '../errors.js';

const body = (e) => ({ error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } });

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// Express recognises error handlers by their 4 arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.parse.failed') err = errors.invalidBody();
  if (err instanceof ApiError) return res.status(err.status).json(body(err));
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: { code: 'BAD_REQUEST', message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}

/** Known paths answered with 405 for methods they do not support (e.g. editing a transaction). */
export const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed).status(405).json({
    error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} is not allowed here. Transactions are immutable.` },
  });
};
