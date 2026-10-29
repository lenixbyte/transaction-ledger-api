import { Router } from 'express';
import { bearerToken } from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';
import { parseBody, schemas } from '../validation.js';

export function authRoutes(db) {
  const r = Router();

  r.post('/signup', async (req, res) => {
    res.status(201).json(await auth.signup(db, parseBody(schemas.signup, req.body)));
  });

  r.post('/login', async (req, res) => {
    res.json(await auth.login(db, parseBody(schemas.login, req.body)));
  });

  r.post('/logout', async (req, res) => {
    await auth.logout(db, bearerToken(req));
    res.status(204).end();
  });

  return r;
}
