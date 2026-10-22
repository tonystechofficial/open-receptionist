# open-receptionist

A provider-agnostic **AI phone receptionist** for small businesses. It answers in French, says it
is an AI, qualifies the caller, offers two real slots from the calendar, books the one chosen, texts
the caller a confirmation and sends the owner a recap.

One architectural choice drives everything: **your database is the source of truth, and the voice
platform is replaceable transport.** The flows, the per-client config and the stored records never
depend on Vapi. Swap the voice layer for Retell, Bland, Telnyx or a self-hosted LiveKit/Pipecat
stack without touching the core.

Maintained by Tony's Tech. MIT licensed.

## How it works

```
  caller --phone--> number --> Vapi (speech-to-text, model, voice)
                                 |  tool calls during the call, end-of-call report after
                                 v
                       POST /api/vapi   (Cloudflare Worker)
                         |          |            |             |
                         v          v            v             v
                      Cal.com      D1          Resend         Brevo
                  slots, booking  calls,      owner email    caller confirmation,
                                appointments                  owner SMS
```

- `src/core/` — pure, tested decisions: `qualify` (clean up what the caller said), `slots` (what to
  offer and how to say it in French, in Paris time), `messages` (the caller SMS and the owner recap),
  `booking`, `config`.
- `src/server/handlers.mjs` — the call flows, described in plain words in [docs/FLOWS.md](docs/FLOWS.md).
- `src/providers/` — adapters behind small interfaces: `voice/` (Vapi; Retell stub), `calendar/`
  (Cal.com; Google stub), `notify/` (Resend email, Brevo SMS).
- `src/db/` — the store: Cloudflare D1 for the Worker, memory or a JSON file for local runs.
- `worker/` — the Cloudflare Worker entry; `api/` — the Vercel entry. Same flows behind both.
- `vapi/create-assistant.mjs` — builds the Vapi assistant from a client config and pushes it.

## One template, many clients

A new client is a new config, not new code. See `config/client.example.json`:

```json
{
  "company": "Plomberie Dupont",
  "metier": "plomberie",
  "telephone": "05 56 12 34 56",
  "calendar": { "provider": "calcom", "id": "123456" },
  "notify": { "email": ["contact@plomberie-dupont.fr"], "sms": ["33612345678"] },
  "urgences": "Odeur de gaz : ... Urgence Sécurité Gaz au 0 800 47 33 33 ..."
}
```

## Quickstart

```bash
npm test     # 88 tests: core, flows, D1 SQL on SQLite, Worker routing. No dependencies, no keys.
```

## Deploy: Cloudflare Workers + D1 (free tier, EU)

```bash
npx wrangler login
npx wrangler d1 create open-receptionist --location weur   # paste the id into wrangler.toml
npm run db:init                                            # applies migrations/
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put CALCOM_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BREVO_API_KEY
# edit the [vars] block in wrangler.toml: company, métier, phone, recipients, Cal.com event type
npm run deploy                                             # -> https://open-receptionist.<you>.workers.dev
```

Then on Vapi:

1. Create a **Custom Credential** of type Bearer Token, header `X-Vapi-Secret`, value = your
   `WEBHOOK_SECRET`, no `Bearer` prefix ([Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication)).
2. Build the assistant from your client config:
   ```bash
   VAPI_PRIVATE_KEY=... VAPI_CREDENTIAL_ID=cred_... \
   WEBHOOK_BASE_URL=https://open-receptionist.<you>.workers.dev \
     node vapi/create-assistant.mjs config/client.json
   ```
3. Attach a phone number to the assistant. A French `+33` number needs a Twilio or Telnyx regulatory
   bundle (identity and a French address), which takes a day or two; start on the number Vapi gives you.
4. In Cal.com, make the event type's **phone number required and email optional**, so callers who only
   give a number can be booked.
5. Run the **first real call checklist** at the end of [docs/FLOWS.md](docs/FLOWS.md).

**Vercel instead:** `api/vapi.mjs` serves the same flows as a Node function. Set the env from
`.env.example`, use the JSON-file store or a hosted database, and `vercel --prod`.

## Data and privacy

Records live in **your** database; the voice platform is told to keep only metadata. Full detail in
[docs/DATA.md](docs/DATA.md); every swappable piece, and the EU-sovereign option, in
[docs/PROVIDERS.md](docs/PROVIDERS.md).

- The assistant **says it is an AI** in its first sentence (EU AI Act, article 50).
- Recording is **off** by default. Turn on Vapi's **Zero Data Retention** so only your webhook keeps
  the content, in your EU-hosted D1.
- Do not promise "data hosted in Europe" in writing until your voice platform confirms EU-only
  processing. For regulated data such as health, use the self-hosted stack in docs/PROVIDERS.md.

## Status

- **Tested:** the core decisions, every call flow end to end with fakes, the D1 migration and SQL on
  real SQLite, and the Worker's routing, authentication and fallback (88 tests).
- **Only a real call proves:** that Vapi fills in `{{customer.number}}` and delivers tool calls, that
  your Cal.com event type accepts phone-only bookings, and that SMS and email are delivered. The
  checklist in docs/FLOWS.md walks through each.
- Vendor APIs drift. The adapters name the documentation and the date they were checked against.
