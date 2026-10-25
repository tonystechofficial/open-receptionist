// npm run deploy: `wrangler deploy`, then README.local.md with the address it published. Wrangler
// writes each deploy's addresses to WRANGLER_OUTPUT_FILE_PATH (one JSON entry per line); the file
// sits in .wrangler/, which git ignores. Its questions (the first workers.dev subdomain) still reach
// the terminal.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const OUTPUT = fileURLToPath(new URL('../.wrangler/deploy-output.ndjson', import.meta.url));

const deploy = spawnSync('npx wrangler deploy', {
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: OUTPUT },
});
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const readme = spawnSync(process.execPath, [fileURLToPath(new URL('./readme-local.mjs', import.meta.url)), '--from-deploy'], { stdio: 'inherit' });
process.exit(readme.status ?? 0);
