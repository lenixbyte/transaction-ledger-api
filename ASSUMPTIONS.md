# Assumptions & design decisions

1. **Accounts have a login.** "Create Account" is `POST /auth/signup` with `name`, `username` and
   `password`. It returns a bearer token. Every read or write on an account uses the account from the
   token, so a client can never pass someone else's id to read or spend their money. Only the
   **recipient** of a transfer is given by account id.
2. **Tokens** are 256-bit random strings. Only their SHA-256 is stored. They expire after 7 days
   (`TOKEN_TTL_HOURS`) and can be revoked with `/auth/logout`. I chose opaque tokens over JWTs because
   they can be revoked instantly and need no signing key to manage. Passwords are hashed with salted
   scrypt (built into Node). Usernames are case-insensitive.
3. **Currency and precision.** There is one implicit currency. Amounts have at most 2 decimals and are
   stored as integer minor units (`BIGINT`), so `0.1 + 0.2` is exactly `0.3`. Responses show major units
   as JSON numbers. A single amount is capped at 1,000,000,000.
4. **Amount input.** `amount` must be a JSON number greater than 0. A plain numeric string such as
   `"12.50"` is also accepted. Booleans, exponent notation, `NaN`/`Infinity` and more than 2 decimals
   return `400 INVALID_AMOUNT`.
5. **Server-owned fields.** `id`, `balance`, `created_at` and `balance_after` are set by the server.
   Any unknown field in a request body is rejected with `400`. This is how "the client cannot set the
   initial balance" is enforced.
6. **Rejected transactions are not stored.** An insufficient-balance debit or an invalid request writes
   nothing, so its `reference_id` stays free.
7. **Duplicates.** Re-using a `reference_id` on the same account returns `409 DUPLICATE_TRANSACTION`,
   with the original in `error.details.existing_transaction`. This happens even if the payload differs.
   The duplicate check runs before the balance check, so retrying a debit that succeeded reports
   "duplicate", not "insufficient balance".
8. **Status codes.** Bad input → `400` (`VALIDATION_ERROR`, `INVALID_REQUEST_BODY`, `INVALID_AMOUNT`,
   `INVALID_TRANSACTION_TYPE`, `INVALID_PAGINATION`). No or bad token → `401`. Unknown resource, or one
   that isn't yours → `404`, so the API does not reveal that it exists. Duplicate → `409`. Insufficient
   balance → `422`.
9. **Transaction type** is case-sensitive: exactly `credit` or `debit`.
10. **Pagination.** `page` defaults to 1 and `limit` to 20, with a maximum of 100. Both must be positive
    integers. A page past the end returns an empty `data` list. `total_pages` is 0 when there are no records.
11. **Ordering.** Latest first by `created_at`, which uses `clock_timestamp()`. Ties are broken by insertion order.
12. **Transfers (bonus).** `POST /me/transfers` takes its own `reference_id`, unique per sender
    (`409 DUPLICATE_TRANSFER`). It writes a debit on the sender and a credit on the recipient, linked by
    `transfer_id`. Each leg's reference is `transfer:<transfer_id>`, so `reference_id`s starting with
    `transfer:` are reserved. Each side sees only its own leg, so the sender never learns the recipient's
    balance. Sending to yourself is rejected.
13. **Database.** Postgres via Supabase, accessed with the `pg` driver over a normal connection, not
    `supabase-js`. Supabase's REST client cannot run multi-statement transactions, and the brief requires
    atomicity. Supabase Auth was not used either; the brief asks for accounts in our own tables.
14. **The brief jumps from section 5 to section 7.** Section 6 was not in the screenshots I received. I
    assumed it covers concurrency/atomicity, which the "Atomicity" heading on that page suggests, and
    implemented both.
