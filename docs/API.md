# API reference

Base URL: `http://127.0.0.1:3000` locally. Interactive docs are at `/docs` (Swagger UI) and the spec is at `/openapi.json`.
Every `/me` route needs `Authorization: Bearer <access_token>`. All bodies are JSON. Amounts are numbers in major units with at most 2 decimals.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance for this debit",
             "details": { "account_id": "…", "balance": 100.0, "requested": 150.0 } } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing, blank, too long or unknown fields. `details` is a list of `{field, message}` |
| 400 | `INVALID_REQUEST_BODY` | Body is missing, not valid JSON, or not an object |
| 400 | `INVALID_AMOUNT` | amount ≤ 0, not a number, more than 2 decimals, or too large |
| 400 | `INVALID_TRANSACTION_TYPE` | `type` is not `credit` or `debit` (body or query) |
| 400 | `INVALID_PAGINATION` | `page`/`limit` not a positive integer, or `limit` > 100 |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | Missing, invalid or expired token; wrong login |
| 404 | `ACCOUNT_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `TRANSFER_NOT_FOUND`, `NOT_FOUND` | Unknown id or route |
| 405 | `METHOD_NOT_ALLOWED` | e.g. `PUT`/`PATCH`/`DELETE` on a transaction (they are immutable) |
| 409 | `USERNAME_TAKEN` | Sign-up with a username that is already used |
| 409 | `DUPLICATE_TRANSACTION` / `DUPLICATE_TRANSFER` | `reference_id` already used. `details` holds the existing record |
| 422 | `INSUFFICIENT_BALANCE` | A debit or transfer larger than the balance |
| 500 | `INTERNAL_ERROR` | Unexpected failure. Nothing is persisted |

## Auth

### `POST /auth/signup` → 201 | 400 | 409
```json
// request
{ "name": "Alice", "username": "alice", "password": "correct-horse" }
// response
{ "access_token": "Jx…", "token_type": "bearer", "expires_at": "2026-11-05T05:00:00.000Z",
  "account": { "id": "38fc…", "name": "Alice", "username": "alice", "balance": 0, "created_at": "…" } }
```
`name` 1–100 characters. `username` 3–50 characters from `[A-Za-z0-9_.-]`, case-insensitive. `password` 8–128
characters. Sending `balance`, `id` or any other field returns `400`.

### `POST /auth/login` → 200 | 401
Takes `{ "username", "password" }` and returns the same shape as signup.

### `POST /auth/logout` → 204
Revokes the token that was sent.

## My account (Bearer token)

### `GET /me` → the account
### `GET /me/balance`
```json
{ "account_id": "38fc…", "balance": 70, "as_of": "2026-10-29T05:10:24.951Z" }
```

### `POST /me/transactions` → 201 | 400 | 409 | 422
```json
{ "type": "credit", "amount": 100, "reference_id": "dep-1", "description": "Deposit" }
```
Returns the transaction, including `balance_after`. Re-sending a `reference_id` already used on this account
returns `409 DUPLICATE_TRANSACTION` with `details.existing_transaction`, and nothing changes. A debit larger than
the balance returns `422 INSUFFICIENT_BALANCE`, and nothing is written.

### `GET /me/transactions?type=credit|debit&page=1&limit=20`
Results are sorted latest first.
```json
{ "data": [ { "id": "…", "account_id": "…", "type": "debit", "amount": 30, "description": "Rent share",
              "reference_id": "transfer:…", "balance_after": 70, "transfer_id": "…", "created_at": "…" } ],
  "pagination": { "page": 1, "limit": 20, "total_records": 2, "total_pages": 1 } }
```

### `GET /me/transactions/:id` → 200 | 404
Transactions are immutable: `PUT`, `PATCH` and `DELETE` return `405`.

## Transfers (bonus)

### `POST /me/transfers` → 201 | 400 | 404 | 409 | 422
```json
// request
{ "to_account_id": "29b7…", "amount": 30, "reference_id": "rent-oct", "description": "Rent share" }
// response (the sender's view)
{ "id": "…", "direction": "sent", "from_account_id": "38fc…", "to_account_id": "29b7…", "amount": 30,
  "description": "Rent share", "reference_id": "rent-oct", "created_at": "…",
  "transaction": { "type": "debit", "balance_after": 70, "transfer_id": "…", … } }
```
The transfer is atomic: either both legs are written or neither is. The recipient must exist and must not be you.
`reference_id` is unique per sender (`409 DUPLICATE_TRANSFER`).

### `GET /me/transfers/:id` → 200 | 404
Visible to the sender (`direction: "sent"`) and the recipient (`"received"`) only. Each side sees only its own leg.

## Health

`GET /health` → `{ "status": "ok" }` (also checks the database). `GET /` redirects to `/docs`.
