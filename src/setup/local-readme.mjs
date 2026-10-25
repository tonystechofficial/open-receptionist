// README.local.md, written by `npm run readme:local` after the first deploy: the remaining steps of
// docs/SETUP.md with the Worker's own address in every command. Pure; the script asks for the address
// and writes the file. Secrets stay placeholders, typed in the terminal, never written down.

/** The Worker's origin from what the deploy printed, or null. https only: workers.dev has no http. */
export function workerUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.origin : null;
  } catch {
    return null;
  }
}

export function localReadme({ url, eventTypeId }) {
  const event = eventTypeId ? ` (\`${eventTypeId}\` now)` : '';
  return `# My deployment: the next commands

Written by \`npm run readme:local\`, ignored by git (\`*.local.md\`). Worker: **${url}**

Secrets stay out of this file: type them in the terminal where \`<...>\` says so.

## 1. Check the Worker (SETUP step 3.5)

A new workers.dev subdomain can take up to an hour to get its certificate after the first deploy.

\`\`\`bash
curl ${url}/health
# {"ok":true}
curl -H "x-vapi-secret: <WEBHOOK_SECRET>" ${url}/api/check
# {"ok":true,"problems":[]}  -- otherwise each problem is spelled out
\`\`\`

In PowerShell, type \`curl.exe\` instead of \`curl\`.

## 2. Vapi (SETUP step 4)

1. Dashboard > **API Keys**: copy the **private** key.
2. Create a **Custom Credential**, type **Bearer Token**, header \`X-Vapi-Secret\`, value your
   \`WEBHOOK_SECRET\`, no \`Bearer\` prefix. Copy its id (\`cred_...\`).
3. Fill \`config/client.json\` with the same values as \`wrangler.toml\` (company, trade, hours, phone,
   towns, recap email, sender, \`calendar.id\`${event}), plus \`infos\`, \`urgences\` and, to put
   emergencies through to you, \`"transfert": { "numero": "06 .. .. .. .." }\`.
4. Create the assistant:

\`\`\`bash
VAPI_PRIVATE_KEY=<private key> VAPI_CREDENTIAL_ID=<cred_...> \\
WEBHOOK_BASE_URL=${url} \\
  node vapi/create-assistant.mjs config/client.json
\`\`\`

Keep the assistant id it prints. To update the assistant later, run the same command with
\`VAPI_ASSISTANT_ID=<assistant id>\` in front.

## 3. The phone number (SETUP step 5)

- To test now: Vapi > **Phone Numbers**, take a free Vapi number, assign the assistant.
- For real: import the Twilio +33 number into Vapi, assign the assistant.

Then screen calls with **one** of the two methods, never both:

- Twilio number: Twilio Console > the number > **Voice > A call comes in** > webhook
  \`${url}/api/twilio/voice\`, method \`POST\`. Redo it after any new import into Vapi.
- Vapi number: set \`VAPI_ASSISTANT_ID\` in \`wrangler.toml\` to the assistant id (\`npm run configure\`
  does not ask it), \`npm run deploy\`, then in Vapi remove the number's assistant and set its
  **Server URL** to \`${url}/api/vapi\` with the credential of step 2.

## 4. First call (SETUP step 6)

\`\`\`bash
npm run cf:tail
\`\`\`

Call, ask for an appointment, hang up, then:

\`\`\`bash
npx wrangler d1 execute open-receptionist --remote \\
  --command "SELECT call_id, status, nom, telephone, deliveries FROM calls ORDER BY created_at DESC LIMIT 5"
\`\`\`

Then turn on **Zero Data Retention** in Vapi's organisation settings.

## Later

- A setting changes: \`npm run configure\`, then \`npm run deploy\`.
- An update of the code: \`git pull\`, \`npm test\`, \`npm run db:init\`, copy any new setting of
  \`wrangler.example.toml\` into \`wrangler.toml\`, \`npm run deploy\`.
- Rotate the webhook secret: \`npm run secret:webhook\`, and update the Vapi credential at once.
`;
}

/**
 * The Worker's address from wrangler's output file (WRANGLER_OUTPUT_FILE_PATH, one JSON entry per
 * line): the https targets of the last deploy, a workers.dev one first. Null when there is none.
 */
export function deployedUrl(ndjson) {
  const entries = String(ndjson ?? '').split(/\r?\n/).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  });
  const last = entries.filter((e) => e?.type === 'deploy').at(-1);
  const urls = (last?.targets ?? []).filter((t) => /^https:\/\/\S+$/.test(String(t).trim())).map(workerUrl).filter(Boolean);
  return urls.find((u) => u.endsWith('.workers.dev')) ?? urls[0] ?? null;
}
