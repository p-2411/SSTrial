import postgres from 'postgres';

/** A connection pool (`Sql`) or an open transaction (`TransactionSql`) — both run queries the same way. */
export type Db = postgres.Sql | postgres.TransactionSql;

export function createDb(url: string, options: { max: number }): postgres.Sql {
  return postgres(url, {
    max: options.max,
    // Supabase's transaction-mode pooler can't use prepared statements. Disabling them costs a
    // little parse time per query but means the app works with either pooler mode.
    prepare: false,
    // Surface slow connects quickly instead of hanging a request.
    connect_timeout: 10,
    // Don't print Postgres NOTICE messages (e.g. "relation already exists, skipping").
    onnotice: () => {},
  });
}

