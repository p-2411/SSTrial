/**
 * Creates an account that can sign in, or changes an existing one's role (and password, if given).
 * Accounts are made here rather than through public sign-up, which is off.
 *
 *   npm run create-user -w server -- --email alice@example.com --password '…' --role admin
 *
 * Against production, run it with the production env file instead of .env.
 */
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { isRole } from '@label-extractor/shared';
import { createMemberStore } from '../src/auth/members.ts';
import { loadApiConfig } from '../src/infra/config.ts';
import { createDb } from '../src/infra/db.ts';

const { values } = parseArgs({
  options: { email: { type: 'string' }, password: { type: 'string' }, role: { type: 'string' } },
});
const { email, password, role } = values;
if (!email || !role || !isRole(role)) {
  console.error('Usage: create-user --email <email> [--password <password>] --role admin|member');
  process.exit(1);
}

const config = loadApiConfig();
const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}).auth.admin;
const sql = createDb(config.DATABASE_URL, { max: 1 });

try {
  const [existing] = await sql`select id from auth.users where email = ${email.toLowerCase()}`;
  let userId: string;
  if (existing) {
    userId = existing.id;
    if (password) {
      const { error } = await admin.updateUserById(userId, { password });
      if (error) throw error;
    }
  } else {
    if (!password) throw new Error('A new account needs --password.');
    // Confirmed straight away: there's no email step, the person is told their password directly.
    const { data, error } = await admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }
  await createMemberStore(sql).setRole(userId, role);
  console.log(`${email} can sign in as ${role === 'admin' ? 'an admin' : 'a member'}.`);
} finally {
  await sql.end();
}
