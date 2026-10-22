// Create or update the Vapi assistant from a client config.
//
//   VAPI_PRIVATE_KEY=... WEBHOOK_BASE_URL=https://your-worker VAPI_CREDENTIAL_ID=cred_... \
//     node vapi/create-assistant.mjs [config/client.json]
//   add VAPI_ASSISTANT_ID=... to update an existing assistant in place.
//
// Webhook authentication: create once, in the Vapi dashboard, a Custom Credential of type
// "Bearer Token" with header name X-Vapi-Secret, value = your WEBHOOK_SECRET, and no "Bearer"
// prefix; pass its id as VAPI_CREDENTIAL_ID. Without it, the legacy inline secret (WEBHOOK_SECRET)
// is used. https://docs.vapi.ai/server-url/server-authentication
// The private key stays on this machine; it is never sent to your deployment.
import { readFile } from 'node:fs/promises';
import { buildAssistant } from '../src/providers/voice/vapi.mjs';
import { validateClientConfig } from '../src/core/config.mjs';

const key = process.env.VAPI_PRIVATE_KEY;
const id = process.env.VAPI_ASSISTANT_ID;
if (!key) {
  console.error('VAPI_PRIVATE_KEY manquante (Dashboard Vapi > API Keys > Private key).');
  process.exit(1);
}
if (!process.env.WEBHOOK_BASE_URL) {
  console.error("WEBHOOK_BASE_URL manquante : l'URL du Worker déployé (ex. https://open-receptionist.<vous>.workers.dev).");
  process.exit(1);
}
if (!process.env.VAPI_CREDENTIAL_ID && !process.env.WEBHOOK_SECRET) {
  console.error('Ni VAPI_CREDENTIAL_ID ni WEBHOOK_SECRET : le Worker refuserait tous les appels de Vapi.');
  process.exit(1);
}

const configArg = process.argv[2];
const configUrl = configArg ? new URL(configArg, `file://${process.cwd()}/`) : new URL('../config/client.json', import.meta.url);
const raw = JSON.parse(await readFile(configUrl, 'utf8'));
const { ok, errors, config } = validateClientConfig(raw);
if (!ok) {
  console.error(`Config client invalide : ${errors.join(' ; ')}`);
  process.exit(1);
}

const assistant = buildAssistant(config, {
  webhookBaseUrl: process.env.WEBHOOK_BASE_URL,
  credentialId: process.env.VAPI_CREDENTIAL_ID,
  serverSecret: process.env.WEBHOOK_SECRET,
});

const url = id ? `https://api.vapi.ai/assistant/${id}` : 'https://api.vapi.ai/assistant';
const res = await fetch(url, {
  method: id ? 'PATCH' : 'POST',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify(assistant),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Vapi a refusé la requête (${res.status}) :\n${text}`);
  process.exit(1);
}
const a = JSON.parse(text);
console.log(`${id ? 'Assistant mis à jour' : 'Assistant créé'} : ${a.id}`);
if (!id) console.log(`À reporter : VAPI_ASSISTANT_ID=${a.id}`);
