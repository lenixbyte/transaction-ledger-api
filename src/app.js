import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { openapi } from './docs/openapi.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { authRoutes } from './routes/auth.routes.js';
import { meRoutes } from './routes/me.routes.js';

function cors(origins) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && (origins.includes('*') || origins.includes(origin))) {
      res.set({
        'Access-Control-Allow-Origin': origins.includes('*') ? '*' : origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        Vary: 'Origin',
      });
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}

function apiRouter(db, base) {
  const r = express.Router();
  // Swagger's "Try it out" must call the same prefix the docs were loaded from.
  const spec = { ...openapi, servers: [{ url: base || '/' }] };

  r.get('/', (_req, res) => res.redirect(`${base}/docs`));
  r.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  r.get('/openapi.json', (_req, res) => res.json(spec));
  r.use('/docs', swaggerUi.serveFiles(spec), swaggerUi.setup(spec, {
    customSiteTitle: 'Transaction Ledger API',
    swaggerOptions: { persistAuthorization: true },
  }));
  r.use('/auth', authRoutes(db));
  r.use('/me', meRoutes(db));
  return r;
}

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors(config.corsOrigins));
  app.use(express.json({ limit: '16kb' }));

  // The API answers both at the root and under /api, so it can share one hostname with the UI
  // (UI at /, API at /api) or have a hostname of its own.
  for (const base of ['/api', '']) app.use(base || '/', apiRouter(db, base));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
