-- Transaction Ledger schema. Safe to run more than once.
-- Money is stored as BIGINT minor units (paise/cents) so arithmetic is exact.

CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  username      VARCHAR(50)  NOT NULL UNIQUE CHECK (username = lower(username)),
  password_hash TEXT         NOT NULL,
  balance       BIGINT       NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash  CHAR(64)    PRIMARY KEY,           -- SHA-256 of the bearer token; the token itself is never stored
  account_id  UUID        NOT NULL REFERENCES accounts(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_auth_tokens_account ON auth_tokens (account_id);

CREATE TABLE IF NOT EXISTS transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_account_id UUID         NOT NULL REFERENCES accounts(id),
  to_account_id   UUID         NOT NULL REFERENCES accounts(id),
  amount          BIGINT       NOT NULL CHECK (amount > 0),
  description     VARCHAR(255),
  reference_id    VARCHAR(100) NOT NULL CHECK (length(btrim(reference_id)) > 0),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_transfers_distinct_accounts CHECK (from_account_id <> to_account_id),
  CONSTRAINT uq_transfers_from_reference UNIQUE (from_account_id, reference_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  seq           BIGSERIAL    PRIMARY KEY,         -- insertion order; tie-breaker for equal created_at
  id            UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  account_id    UUID         NOT NULL REFERENCES accounts(id),
  type          VARCHAR(6)   NOT NULL CHECK (type IN ('credit', 'debit')),
  amount        BIGINT       NOT NULL CHECK (amount > 0),
  description   VARCHAR(255),
  reference_id  VARCHAR(100) NOT NULL CHECK (length(btrim(reference_id)) > 0),
  balance_after BIGINT       NOT NULL CHECK (balance_after >= 0),
  transfer_id   UUID         REFERENCES transfers(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_transactions_account_reference UNIQUE (account_id, reference_id)
);
CREATE INDEX IF NOT EXISTS ix_transactions_history ON transactions (account_id, created_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS ix_transactions_transfer ON transactions (transfer_id) WHERE transfer_id IS NOT NULL;

-- Transactions and transfers are append-only: block UPDATE and DELETE at the database level.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS transactions_immutable ON transactions;
CREATE TRIGGER transactions_immutable BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

DROP TRIGGER IF EXISTS transfers_immutable ON transfers;
CREATE TRIGGER transfers_immutable BEFORE UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Supabase exposes the public schema through its auto-generated REST API (PostgREST).
-- This app talks to Postgres directly, so lock those roles out: enable RLS with no policies
-- and revoke their grants. A no-op on plain Postgres where the roles do not exist.
ALTER TABLE accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON accounts, auth_tokens, transfers, transactions FROM %I', r);
    END IF;
  END LOOP;
END $$;
