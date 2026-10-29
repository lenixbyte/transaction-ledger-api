import 'dotenv/config';

const int = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : Number.parseInt(v, 10);
};

export const config = {
  port: int('PORT', 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
  // Supabase and most hosted Postgres need TLS; set DATABASE_SSL=false for a local server.
  databaseSsl: (process.env.DATABASE_SSL ?? 'auto') !== 'false',
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  tokenTtlHours: int('TOKEN_TTL_HOURS', 168),
  defaultPageSize: 20,
  maxPageSize: 100,
  maxAmount: 1_000_000_000, // largest single amount, in major units
};
