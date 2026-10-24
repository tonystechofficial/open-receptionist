// Makes a random WEBHOOK_SECRET, sets it on the Worker with `wrangler secret put`, and shows it once:
// the Vapi credential needs the same value (README, docs/SETUP.md step 3.2). Running it again rotates
// the secret: update the Vapi credential at the same time.
//
//   npm run secret:webhook
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

const secret = randomBytes(32).toString('hex');
try {
  // With stdin a pipe, wrangler reads the value from it instead of prompting (and creates the Worker
  // if it does not exist yet, as it does when prompting).
  execSync('npx wrangler secret put WEBHOOK_SECRET', { input: secret, stdio: ['pipe', 'inherit', 'inherit'] });
} catch {
  console.error('wrangler did not set WEBHOOK_SECRET (its message is above). Logged in? npx wrangler login');
  process.exit(1);
}
console.log(`\nWEBHOOK_SECRET is set on the Worker. Keep it now, in your password manager: the Vapi credential
needs the same value (step 4), and it is not shown again. Lost it? Run this again and update Vapi.\n\n  ${secret}\n`);
