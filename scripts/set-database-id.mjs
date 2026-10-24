// Writes the id of the D1 database named in wrangler.toml into wrangler.toml, in place of
// REPLACE_WITH_D1_DATABASE_ID (README, docs/SETUP.md step 3.1). Run it right after `wrangler d1 create`.
// The first time, it creates wrangler.toml from wrangler.example.toml: git ignores wrangler.toml,
// which holds this deployment's values.
//
//   npm run db:id
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { planDatabaseId } from '../src/providers/hosting/wrangler-database-id.mjs';

const file = new URL('../wrangler.toml', import.meta.url);
const template = new URL('../wrangler.example.toml', import.meta.url);
const creating = !existsSync(file);
const toml = readFileSync(creating ? template : file, 'utf8');
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
if (creating || plan.toml !== toml) writeFileSync(file, plan.toml);
if (creating) console.log("Created wrangler.toml from wrangler.example.toml. Git ignores it: it holds this deployment's values.");
console.log(plan.message);
if (plan.warning) console.warn(`Warning: ${plan.warning}`);
