// Writes README.local.md: the steps after the deploy, with this Worker's address in every command.
// Run it after the first `npm run deploy`, with the address the deploy printed:
//
//   npm run readme:local -- https://open-receptionist.<your-subdomain>.workers.dev
//   npm run readme:local            (asks for the address)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { workerUrl, localReadme } from '../src/setup/local-readme.mjs';
import { readVars } from '../src/providers/hosting/wrangler-vars.mjs';

let raw = process.argv[2];
if (!raw) {
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
console.log(`README.local.md written for ${url}`);

try {
  const res = await fetch(`${url}/health`);
  console.log(res.ok ? `${url}/health answers: the Worker is up.` : `${url}/health answered ${res.status}: check the deploy.`);
} catch {
  console.log(`${url}/health does not answer yet: a new workers.dev subdomain can take up to an hour.`);
}
