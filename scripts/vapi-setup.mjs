// npm run vapi:setup: sets up Vapi for this deployment (docs/SETUP.md step 4), from .env.local (ignored
// by git), which holds VAPI_PRIVATE_KEY. Run after npm run deploy; run again after changing
// config/client.json, to update the assistant. No secret is ever printed.
//
//  1. The credential: a new random WEBHOOK_SECRET, set on the Worker (wrangler secret put) and in a
//     Vapi custom credential sent as X-Vapi-Secret. Both are kept in .env.local, and reused next time.
//  2. The assistant, built from config/client.json and pointed at the Worker with that credential:
//     created the first time, updated in place after (VAPI_ASSISTANT_ID in .env.local).
//  3. The check: the Worker's /api/check, called with the secret, must answer.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readEnv, writeEnv, credentialBody } from '../src/setup/vapi-setup.mjs';
import { deployedUrl } from '../src/setup/local-readme.mjs';
import { validateClientConfig } from '../src/core/config.mjs';
import { buildAssistant } from '../src/providers/voice/vapi.mjs';

const envFile = new URL('../.env.local', import.meta.url);
const env = existsSync(envFile) ? readEnv(readFileSync(envFile, 'utf8')) : {};
const save = (values) => {
  writeFileSync(envFile, writeEnv(existsSync(envFile) ? readFileSync(envFile, 'utf8') : '', values));
  Object.assign(env, values);
};
const key = env.VAPI_PRIVATE_KEY;
if (!key) {
  console.error('VAPI_PRIVATE_KEY is missing in .env.local (Vapi dashboard > API Keys > Private key).');
  process.exit(1);
}

const output = new URL('../.wrangler/deploy-output.ndjson', import.meta.url);
const workerUrl = process.env.WEBHOOK_BASE_URL || (existsSync(output) ? deployedUrl(readFileSync(output, 'utf8')) : null);
if (!workerUrl) {
  console.error('No Worker address: run npm run deploy first, or set WEBHOOK_BASE_URL.');
  process.exit(1);
}

async function vapi(method, path, body) {
  const res = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const error = new Error(`Vapi refused ${method} ${path} (${res.status}): ${text.slice(0, 400)}`);
    error.status = res.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

const raw = JSON.parse(readFileSync(new URL('../config/client.json', import.meta.url), 'utf8'));
const { ok, errors, config } = validateClientConfig(raw);
if (!ok) {
  console.error(`config/client.json is refused: ${errors.join('; ')}`);
  process.exit(1);
}

try {
  // 1. The credential, reused when it still exists at Vapi.
  let credentialId = env.VAPI_CREDENTIAL_ID;
  if (credentialId && env.WEBHOOK_SECRET) {
    try {
      await vapi('GET', `/credential/${credentialId}`);
      console.log(`Credential ${credentialId}: kept.`);
    } catch (e) {
      if (e.status !== 404) throw e;
      credentialId = null;
    }
  } else credentialId = null;
  if (!credentialId) {
    const secret = randomBytes(32).toString('hex');
    execSync('npx wrangler secret put WEBHOOK_SECRET', { input: secret, stdio: ['pipe', 'ignore', 'inherit'] });
    save({ WEBHOOK_SECRET: secret });
    const credential = await vapi('POST', '/credential', credentialBody(secret));
    credentialId = credential.id;
    save({ VAPI_CREDENTIAL_ID: credentialId });
    console.log(`New webhook secret set on the Worker and in Vapi credential ${credentialId} (both kept in .env.local).`);
  }

  // 2. The assistant.
  const assistant = buildAssistant(config, { webhookBaseUrl: workerUrl, credentialId });
  let assistantId = env.VAPI_ASSISTANT_ID;
  if (assistantId) {
    try {
      await vapi('PATCH', `/assistant/${assistantId}`, assistant);
      console.log(`Assistant ${assistantId} ("${assistant.name}"): updated from config/client.json.`);
    } catch (e) {
      if (e.status !== 404) throw e;
      assistantId = null;
    }
  }
  if (!assistantId) {
    assistantId = (await vapi('POST', '/assistant', assistant)).id;
    save({ VAPI_ASSISTANT_ID: assistantId });
    console.log(`Assistant ${assistantId} ("${assistant.name}"): created from config/client.json.`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// 3. The Worker recognises the secret Vapi will send.
const check = await fetch(`${workerUrl}/api/check`, { headers: { 'x-vapi-secret': env.WEBHOOK_SECRET } });
const result = await check.json().catch(() => ({}));
if (check.status === 401) console.log('/api/check refused the new secret: wait a minute for the Worker to take it, then run npm run vapi:setup again.');
else if (result.ok) console.log('/api/check: no problem.');
else console.log(`/api/check reports:\n- ${(result.problems ?? [`HTTP ${check.status}`]).join('\n- ')}`);

console.log(`
In the Vapi dashboard: Assistants > "${config.company} - accueil" > Talk to Assistant, to try it in the
browser. To give it a phone number: Phone Numbers (docs/SETUP.md step 5).`);
