// Writes README.local.md: the steps after the deploy, with this Worker's address in every command.
// `npm run deploy` runs it with the address it just published; run it alone to rewrite the file:
//
//   npm run readme:local                     (the address of the last npm run deploy)
//   npm run readme:local -- https://...      (another address, such as a custom domain)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { workerUrl, localReadme, deployedUrl } from '../src/setup/local-readme.mjs';
import { readVars } from '../src/providers/hosting/wrangler-vars.mjs';

const output = new URL('../.wrangler/deploy-output.ndjson', import.meta.url);
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const fromDeploy = existsSync(output) ? deployedUrl(readFileSync(output, 'utf8')) : null;

let raw = arg ?? fromDeploy;
if (!raw) {
  if (process.argv.includes('--from-deploy')) {
    console.log('The deploy published no https address: README.local.md not written. Run npm run readme:local -- <address>.');
    process.exit(0);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  raw = await new Promise((resolve) => rl.question("Your Worker's address, as npm run deploy printed it: ", (a) => { rl.close(); resolve(a); }));
}
const url = workerUrl(raw);
if (!url) {
  console.error(`"${raw}" is not an https:// address, such as https://open-receptionist.<your-subdomain>.workers.dev`);
  process.exit(1);
}

const toml = new URL('../wrangler.toml', import.meta.url);
const eventTypeId = existsSync(toml) ? readVars(readFileSync(toml, 'utf8')).active.CALCOM_EVENT_TYPE_ID : undefined;
writeFileSync(new URL('../README.local.md', import.meta.url), localReadme({ url, eventTypeId }));
console.log(`\nREADME.local.md written for ${url}: the next commands, with this address.`);

try {
  const res = await fetch(`${url}/health`);
  console.log(res.ok ? `${url}/health answers: the Worker is up.` : `${url}/health answered ${res.status}: check the deploy.`);
} catch {
  console.log(`${url}/health does not answer yet: a new workers.dev subdomain can take up to an hour.`);
}
