import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { createMemberStore } from '../../src/auth/members.ts';
import { createDb } from '../../src/infra/db.ts';

/** Needs `supabase start`; skipped when TEST_DATABASE_URL isn't set (see worker.integration.test.ts). */
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)('members (real SQL)', () => {
  let sql: postgres.Sql;
  const userId = crypto.randomUUID();
  const email = `test-${userId}@example.com`;

  beforeAll(async () => {
    sql = createDb(DATABASE_URL!, { max: 2 });
    // A bare Supabase Auth account, as the admin API would create.
    await sql`insert into auth.users (id, email) values (${userId}, ${email})`;
  });

  afterAll(async () => {
    await sql`delete from auth.users where id = ${userId}`; // cascades to members
    await sql.end();
  });

  it('gives no access until a role is set, then reports it with the account email', async () => {
    const members = createMemberStore(sql);
    expect(await members.find(userId)).toBeNull();

    await members.setRole(userId, 'member');
    expect(await members.find(userId)).toEqual({ id: userId, email, role: 'member' });

    await members.setRole(userId, 'admin');
    expect((await members.find(userId))?.role).toBe('admin');
  });

  it("knows an account's email even without access", async () => {
    const members = createMemberStore(sql);
    expect(await members.emailOf(userId)).toBe(email);
    expect(await members.emailOf(crypto.randomUUID())).toBeNull();
  });
});
