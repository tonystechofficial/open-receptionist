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
                      Cal.com      D1          Resend         Twilio (or Brevo)
                  slots, booking  calls,      owner email    caller confirmation,
                                appointments                  owner SMS
```

- `src/core/` — pure, tested decisions: `qualify` (clean up what the caller said), `slots` (what to
  offer and how to say it in French, in Paris time), `messages` (the caller SMS and the owner recap),
  `phone` (normalising numbers, mobiles only for SMS), `alerts` (what the daily check reports),
  `booking`, `config`.
- `src/server/handlers.mjs` — the call flows, described in plain words in [docs/FLOWS.md](docs/FLOWS.md).
- `src/providers/` — adapters behind small interfaces: `voice/` (Vapi; Retell stub), `calendar/`
  (Cal.com; Google stub), `notify/` (Resend email; Twilio or Brevo SMS, picked from the keys set).
- `src/db/` — the store: Cloudflare D1 for the Worker, memory or a JSON file for local runs.
- `worker/` — the Cloudflare Worker entry, with a daily cron check that emails failed messages and a
  refused SMS key; `api/` — the Vercel entry. Same flows behind both.
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
  "smsSender": "Dupont",
  "urgences": "Odeur de gaz : ... le 05 56 79 41 00 de Régaz-Bordeaux ..., sinon Urgence Sécurité Gaz au 0 800 47 33 33 ..."
}
```

## Quickstart

```bash
npm test     # 144 tests: core, flows, D1 SQL on SQLite, Worker routing and daily check. No dependencies, no keys.
```

## Deploy: Cloudflare Workers + D1 (free tier, EU)

For a production setup from zero, accounts and compliance included, follow
[docs/SETUP.md](docs/SETUP.md). The short version:

**Accounts first:** Cloudflare (free), Cal.com, Vapi, Resend with a verified sending domain, and
Twilio **upgraded out of the trial** with automatic recharge on. A trial account cannot send SMS under
the business's name and only texts verified numbers.

```bash
npx wrangler login
npx wrangler d1 create open-receptionist --location weur   # paste the id into wrangler.toml
npm run db:init                                            # applies every file in migrations/
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put CALCOM_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID                 # SMS through Twilio; or BREVO_API_KEY for Brevo
npx wrangler secret put TWILIO_AUTH_TOKEN
# edit the [vars] block in wrangler.toml: company, métier, phone, recipients (an email is required),
# Cal.com event type, SMS_SENDER (the business's short name) and ALERT_EMAIL (you)
npm run deploy                                             # -> https://open-receptionist.<you>.workers.dev
curl https://open-receptionist.<you>.workers.dev/health    # {"ok":true}
curl -H "x-vapi-secret: <WEBHOOK_SECRET>" https://open-receptionist.<you>.workers.dev/api/check
# {"ok":true,"problems":[]}  -- otherwise each problem is spelled out
```

The deploy also schedules the **daily check** (`[triggers]` in `wrangler.toml`, 06:00 UTC): it emails
`ALERT_EMAIL` when the configuration, a provider key, the SMS credit or a message sent in the last
24 hours has a problem.

To **update** a running deployment: `git pull`, `npm test`, `npm run db:init` (applies any new
migration), then `npm run deploy`.

Then on Vapi:

1. Create a **Custom Credential** of type Bearer Token, header `X-Vapi-Secret`, value = your
   `WEBHOOK_SECRET`, no `Bearer` prefix ([Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication)).
2. Build the assistant from your client config:
   ```bash
   VAPI_PRIVATE_KEY=... VAPI_CREDENTIAL_ID=cred_... \
   WEBHOOK_BASE_URL=https://open-receptionist.<you>.workers.dev \
     node vapi/create-assistant.mjs config/client.json
   ```
3. Attach a phone number to the assistant. Buy the French `+33` number at Twilio, so one account
   carries the number and the SMS. It needs a regulatory bundle (identity and a French address), which
   takes a day or two; start on the number Vapi gives you, then import the Twilio number into Vapi.
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

- **Tested:** the core decisions, every call flow end to end with fakes, the D1 migrations and SQL on
  real SQLite, the Twilio and Brevo adapters, and the Worker's routing, authentication, fallback and
  daily check (144 tests).
- **Only a real call proves:** that Vapi fills in `{{customer.number}}` and delivers tool calls, that
  your Cal.com event type accepts phone-only bookings, and that SMS and email are delivered. The
  checklist in docs/FLOWS.md walks through each.
- Vendor APIs drift. The adapters name the documentation and the date they were checked against.
