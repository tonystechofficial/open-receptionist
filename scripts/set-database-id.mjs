// Writes the id of the D1 database named in wrangler.toml into wrangler.toml, in place of
// REPLACE_WITH_D1_DATABASE_ID (README, docs/SETUP.md step 3.1). Run it right after `wrangler d1 create`:
//
//   npm run db:id
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { planDatabaseId } from '../src/providers/hosting/wrangler-database-id.mjs';

const file = new URL('../wrangler.toml', import.meta.url);
const toml = readFileSync(file, 'utf8');
let databases;
try {
  databases = JSON.parse(execSync('npx wrangler d1 list --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
} catch {
  console.error('Could not list the D1 databases. Log in first: npx wrangler login');
  process.exit(1);
}
const plan = planDatabaseId({ toml, databases });
if (plan.error) {
  console.error(plan.error);
  process.exit(1);
}
if (plan.toml !== toml) writeFileSync(file, plan.toml);
console.log(plan.message);
if (plan.warning) console.warn(`Warning: ${plan.warning}`);
