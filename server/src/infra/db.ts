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

/**
 * Adapts a postgres.js transaction to the minimal interface pg-boss uses to run SQL, so a job can
 * be enqueued *inside* the same transaction as our own writes (see uploads/store.ts).
 */
export function asPgBossDb(tx: Db) {
  return {
    async executeSql(text: string, values: unknown[] = []) {
      const rows = await tx.unsafe(text, values as postgres.ParameterOrJSON<never>[]);
      return { rows: [...rows] };
    },
  };
}
