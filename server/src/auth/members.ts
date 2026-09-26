import type postgres from 'postgres';
import { isRole, type CurrentMember, type Role } from '@label-extractor/shared';

/** The people with access (`members`), with the email from their Supabase Auth account. */
export interface MemberStore {
  /** The member with this user ID, or null if they have no access. */
  find(userId: string): Promise<CurrentMember | null>;
  /**
   * The emails of these accounts, whether or not they have access (e.g. to name who uploaded
   * something). An account that no longer exists is left out.
   */
  emailsOf(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Gives access with this role, or changes the role of someone who already has access. */
  setRole(userId: string, role: Role): Promise<void>;
}

export function createMemberStore(sql: postgres.Sql): MemberStore {
  return {
    async find(userId) {
      const [row] = await sql`
        select m.user_id, m.role, u.email
        from members m join auth.users u on u.id = m.user_id
        where m.user_id = ${userId}`;
      if (!row || !isRole(row.role)) return null;
      return { id: row.user_id, email: row.email, role: row.role };
    },

    async emailsOf(userIds) {
      if (userIds.length === 0) return new Map();
      const rows = await sql`select id, email from auth.users where id = any(${[...userIds]}::uuid[])`;
      return new Map(rows.map((row) => [row.id as string, row.email as string]));
    },

    async setRole(userId, role) {
      await sql`
        insert into members (user_id, role) values (${userId}, ${role})
        on conflict (user_id) do update set role = excluded.role`;
    },
  };
}
