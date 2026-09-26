/**
 * Creates an account that can sign in, or changes an existing one's role (and its password, with
 * --new-password). Accounts are made here rather than through public sign-up, which is off.
 *
 *   npm run create-user -w server -- --email alice@example.com --role admin [--new-password]
 *
 * The password is asked for without echoing it (or read from stdin when piped), never passed as an
 * argument: arguments end up in shell history and are visible to other processes.
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
  options: { email: { type: 'string' }, role: { type: 'string' }, 'new-password': { type: 'boolean' } },
});
const { email, role } = values;
if (!email || !role || !isRole(role)) {
  console.error('Usage: create-user --email <email> --role admin|member [--new-password]');
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
    if (values['new-password']) {
      const { error } = await admin.updateUserById(userId, { password: await askPassword('New password: ') });
      if (error) throw error;
    }
  } else {
    // Confirmed straight away: there's no email step, the person is told their password directly.
    const password = await askPassword('Password for the new account: ');
    const { data, error } = await admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
  }
  await createMemberStore(sql).setRole(userId, role);
  console.log(`${email} can sign in as ${role === 'admin' ? 'an admin' : 'a member'}.`);
} finally {
  await sql.end();
}

/** Asks for a password without echoing it; when stdin isn't a terminal (piped), reads it from there. */
async function askPassword(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    let piped = '';
    for await (const chunk of stdin) piped += chunk;
    return piped.trim();
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  let password = '';
  try {
    for await (const keys of stdin) {
      for (const key of keys as string) {
        if (key === '\r' || key === '\n') {
          stdout.write('\n');
          return password;
        }
        if (key === '\u0003') process.exit(130); // Ctrl-C
        password = key === '\u007f' ? password.slice(0, -1) : password + key; // Backspace, or a character
      }
    }
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
  return password;
}
