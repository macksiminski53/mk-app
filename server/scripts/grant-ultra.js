// One-off admin tool: grant (or revoke) MK PLUS, MK PREMIUM, or MK ULTRA for
// specific usernames without needing a Stripe purchase. Useful for comping
// the app owner, testers, etc.
//
// Usage (run from server/):
//   node scripts/grant-ultra.js alice bob                (grants MK ULTRA)
//   node scripts/grant-ultra.js --plus alice              (grants MK PLUS instead)
//   node scripts/grant-ultra.js --premium alice bob       (grants MK PREMIUM instead)
//   node scripts/grant-ultra.js --revoke alice            (revokes whichever tier(s) they have)
//   node scripts/grant-ultra.js --revoke --plus alice     (revokes MK PLUS specifically)
//   node scripts/grant-ultra.js --revoke --premium alice  (revokes MK PREMIUM specifically)
//
// Connects to whatever database db.js normally connects to -- set
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN in the environment first if you want
// this to hit your production database rather than the local SQLite file.

import { db, initSchema } from '../db.js';

const TIERS = {
  plus: { column: 'is_plus', name: 'MK PLUS' },
  premium: { column: 'is_premium', name: 'MK PREMIUM' },
  ultra: { column: 'is_ultra', name: 'MK ULTRA' },
};

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const tierFlags = ['plus', 'premium', 'ultra'].filter((t) => args.includes(`--${t}`));
  if (tierFlags.length > 1) {
    console.error(`Only one of --plus/--premium/--ultra can be given at a time (got: ${tierFlags.join(', ')})`);
    process.exit(1);
  }
  const tierKey = tierFlags[0] || 'ultra';
  const usernames = args.filter((a) => !a.startsWith('--'));

  if (usernames.length === 0) {
    console.error('Usage: node scripts/grant-ultra.js [--revoke] [--plus|--premium|--ultra] <username> [username2 ...]');
    process.exit(1);
  }

  await initSchema();

  const { column, name: tierName } = TIERS[tierKey];

  for (const username of usernames) {
    const row = await db.prepare('SELECT id, username, is_plus, is_premium, is_ultra FROM users WHERE username = ?').get(username);
    if (!row) {
      console.error(`✗ No user named "${username}" found`);
      continue;
    }
    if (revoke) {
      if (tierFlags[0]) {
        await db.prepare(`UPDATE users SET ${column} = 0 WHERE id = ?`).run(row.id);
      } else {
        await db.prepare('UPDATE users SET is_plus = 0, is_premium = 0, is_ultra = 0 WHERE id = ?').run(row.id);
      }
      console.log(`✗ revoked ${tierName} for "${row.username}" (id ${row.id})`);
    } else {
      await db.prepare(`UPDATE users SET ${column} = 1 WHERE id = ?`).run(row.id);
      console.log(`✓ granted ${tierName} for "${row.username}" (id ${row.id})`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('grant-ultra failed:', err);
  process.exit(1);
});
