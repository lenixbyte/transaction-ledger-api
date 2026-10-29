# Transaction Ledger API

A backend for a simple ledger. Users sign up and log in, then post credit/debit transactions, read their
balance and paginated history, and send money to other accounts. It is built with **Node.js (Express 5)**
and **PostgreSQL / Supabase**, uses `pg` with plain SQL, and validates input with `zod`. A small static
frontend lives in `frontend/`.

**Live demo** at https://ledger.tail0c6028.ts.net, hosted via Tailscale Funnel
- UI: https://ledger.tail0c6028.ts.net. Log in as `demo_a` or `demo_b` (password `demo-pass-123`), or create an account.
- API: https://ledger.tail0c6028.ts.net/api
- Swagger docs: https://ledger.tail0c6028.ts.net/api/docs. The spec is at `/api/openapi.json`.

More docs: the API reference is in [`docs/API.md`](docs/API.md), and assumptions and design decisions are in [`ASSUMPTIONS.md`](ASSUMPTIONS.md).

## Run locally

Requires Node.js 18+ and a Postgres database (a Supabase project or any local Postgres).

```bash
npm install
cp .env.example .env          # then set DATABASE_URL
npm run migrate               # creates tables (also runs automatically on start)
npm start                     # http://127.0.0.1:3000  →  Swagger UI at /docs (also /api/docs)
```

- **Supabase:** in Project Settings → Database → Connection string, copy the URI (the Session pooler URI
  works on IPv4 networks) into `DATABASE_URL`. TLS is switched on automatically.
- **Local Postgres in Docker:**
  `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine`, then use the default `DATABASE_URL`.
- **Frontend:** `npx serve frontend -l 5500` (or `python3 -m http.server 5500 -d frontend`), then open
  http://127.0.0.1:5500. Set `window.API_BASE = "http://127.0.0.1:3000"` in `frontend/config.js`.
  It defaults to `<same origin>/api`, which is how it is deployed (UI at `/`, API at `/api`).
- **Docker:** `docker build -t ledger . && docker run -p 3000:3000 -e DATABASE_URL=... ledger`

## Tests

```bash
docker run -d --name ledger-test-pg -p 127.0.0.1:55450:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=ledger_test postgres:16-alpine
npm test        # or set TEST_DATABASE_URL to use another database
```

The 81 tests use `node:test` and `supertest` against a real Postgres. Each test file runs in its own
throwaway schema. They cover every rule in the brief, plus:
- 40 parallel debits that must never overdraw
- 20 parallel copies of one request that must create exactly one row
- 30 opposite transfers in parallel that must not deadlock and must conserve money
- a transfer that fails after its debit and must roll back fully
- direct SQL edits or deletes of transactions, which the database must refuse
- auth: hashed passwords and tokens, expiry, logout, and users not seeing each other's data

## API at a glance

| Method | Path | Auth | What it does |
|---|---|---|---|
| POST | `/auth/signup` | – | Create an account (balance 0) and get a token |
| POST | `/auth/login` | – | Get a token |
| POST | `/auth/logout` | Bearer | Revoke the token |
| GET | `/me` | Bearer | My account |
| GET | `/me/balance` | Bearer | My balance |
| POST | `/me/transactions` | Bearer | Credit or debit (idempotent by `reference_id`) |
| GET | `/me/transactions?type=&page=&limit=` | Bearer | History, latest first |
| GET | `/me/transactions/:id` | Bearer | One of my transactions |
| POST | `/me/transfers` | Bearer | Send money to another account id (bonus) |
| GET | `/me/transfers/:id` | Bearer | A transfer I sent or received |

Every route is also available under the `/api` prefix (e.g. `/api/me/balance`), so the UI and API can share one hostname. The account always comes from the token. No route accepts an account id for reading or spending; only
the recipient of a transfer is given by id.

## Project structure

```
src/
  server.js            start-up: run migrations, listen
  app.js               express app: CORS, JSON, Swagger, routes, error handler
  config.js  db.js     settings; pg pool and withTransaction()
  migrate.js           applies migrations/*.sql
  validation.js        zod schemas, amount parsing, pagination parsing
  errors.js            ApiError + every error code
  middleware/          bearer-token auth, error/404/405 handlers
  routes/              auth.routes.js, me.routes.js (HTTP only)
  services/            auth.service.js, ledger.service.js (business rules, SQL)
  docs/openapi.js      OpenAPI 3 spec for Swagger UI
migrations/001_init.sql  tables, constraints, immutability triggers, Supabase lockdown
frontend/              static UI (index.html + config.js)
test/                  node:test suites
```

## How integrity is guaranteed

| Rule | How |
|---|---|
| Atomic: transaction + balance | One DB transaction (`withTransaction`): `BEGIN` → update balance → insert row → `COMMIT`. Any error rolls back. |
| No overdraft under concurrency | The account row is locked with `SELECT … FOR UPDATE`. The debit is one conditional `UPDATE … SET balance = balance - $2 WHERE balance >= $2`. `CHECK (balance >= 0)` is the last line of defence. |
| Duplicate `reference_id` | Checked under the row lock, and backed by `UNIQUE (account_id, reference_id)`. Returns `409` with the original transaction. |
| Immutable transactions | No update or delete routes (`405`). Postgres triggers reject any `UPDATE`/`DELETE` on `transactions` and `transfers`. |
| Balance = sum of transactions | Balances only change in the same unit of work that inserts the transaction. Each row stores `balance_after`. Rejected requests write nothing. |
| Atomic transfers | One DB transaction. Both accounts are locked in id order, which avoids deadlocks, then the debit and the credit run. A failure anywhere rolls back everything. |
| Exact money | Stored as `BIGINT` minor units (paise/cents), never floats. |
| Supabase exposure | RLS is enabled with no policies, and `anon`/`authenticated` lose their grants. Supabase's auto REST API cannot read these tables; only this server, which connects as the DB owner, can. |
