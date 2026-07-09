// One-off admin tool: grant (or revoke) MK ULTRA for specific usernames
// without needing a Stripe purchase. Useful for comping the app owner,
// testers, etc.
//
// Usage (run from server/):
//   node scripts/grant-ultra.js alice bob
//   node scripts/grant-ultra.js --revoke alice
//
// Connects to whatever database db.js normally connects to -- set
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in the environment first if you want
// this to hit your production database rather than the local SQLite file.

import { db, initSchema } from '../db.js';

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const usernames = args.filter((a) => a !== '--revoke');

  if (usernames.length === 0) {
    console.error('Usage: node scripts/grant-ultra.js [--revoke] <username> [username2 ...]');
    process.exit(1);
  }

  await initSchema();

  for (const username of usernames) {
    const row = await db.prepare('SELECT id, username, is_ultra FROM users WHERE username = ?').get(username);
    if (!row) {
      console.error(`✗ No user named "${username}" found`);
      continue;
    }
    await db.prepare('UPDATE users SET is_ultra = ? WHERE id = ?').run(revoke ? 0 : 1, row.id);
    console.log(`${revoke ? '✗ revoked' : '✓ granted'} MK ULTRA for "${row.username}" (id ${row.id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('grant-ultra failed:', err);
  process.exit(1);
});
