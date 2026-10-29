import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { methodNotAllowed } from '../middleware/errors.js';
import * as ledger from '../services/ledger.service.js';
import { parseBody, parsePagination, parseTypeFilter, schemas } from '../validation.js';

/** Everything about the logged-in account. The account always comes from the token. */
export function meRoutes(db) {
  const r = Router();
  r.use(requireAuth(db));

  r.get('/', async (req, res) => res.json(await ledger.getAccount(db, req.accountId)));

  r.get('/balance', async (req, res) => res.json(await ledger.getBalance(db, req.accountId)));

  r.route('/transactions')
    .get(async (req, res) => {
      const type = parseTypeFilter(req.query);
      const { page, limit } = parsePagination(req.query);
      res.json(await ledger.listTransactions(db, req.accountId, { type, page, limit }));
    })
    .post(async (req, res) => {
      res.status(201).json(await ledger.addTransaction(db, req.accountId, parseBody(schemas.transaction, req.body)));
    })
    .all(methodNotAllowed('GET, POST'));

  r.route('/transactions/:id')
    .get(async (req, res) => res.json(await ledger.getTransaction(db, req.accountId, req.params.id)))
    .all(methodNotAllowed('GET'));

  r.route('/transfers')
    .post(async (req, res) => {
      res.status(201).json(await ledger.createTransfer(db, req.accountId, parseBody(schemas.transfer, req.body)));
    })
    .all(methodNotAllowed('POST'));

  r.route('/transfers/:id')
    .get(async (req, res) => res.json(await ledger.getTransfer(db, req.accountId, req.params.id)))
    .all(methodNotAllowed('GET'));

  return r;
}
