# open-receptionist

A provider-agnostic **AI phone receptionist** for small businesses. It answers in a natural
French voice, qualifies the caller (name, need, urgency, contact), books a slot in a calendar,
and sends a recap by email and SMS.

The point of this project is one architectural choice: **your database is the source of truth,
and the voice platform is replaceable transport.** The business logic, the per-client config and
the stored records never depend on Vapi. Swap the voice layer for Retell, Bland, Telnyx or a
self-hosted LiveKit/Pipecat stack without touching the core.

Maintained by Tony's Tech. MIT licensed.

## How it works

```
  caller ──phone──▶  voice platform  ──tool calls──▶  /api/tools   ──▶  calendar (Cal.com / Google)
                     (Vapi today)                         │
                                       ──end-of-call──▶  /api/call-report
                                                           │  qualify + store
                                                           ▼
                                            YOUR DB  ──▶  recap (email + SMS)
                                        (source of truth)
```

- `src/core/` — pure, tested decisions: `qualify` (clean up what the caller said), `chooseSlot`
  (pick the slot to offer from urgency), `validateClientConfig`. No DB, no network.
- `src/providers/` — thin adapters behind one interface: `voice/` (Vapi, Retell stub),
  `calendar/` (Cal.com, Google stub), `notify/` (Resend email, Brevo SMS).
- `src/server/` — the glue that wires the core to the providers and the store.
- `api/` — two serverless webhooks (`tools`, `call-report`) the voice platform calls.
- `vapi/create-assistant.mjs` — builds the assistant from a client config and pushes it to Vapi.

## One template, many clients

A new client is a new config, not new code. See `config/client.example.json`:

```json
{
  "company": "Plomberie Dupont",
  "metier": "plomberie",
  "horaires": "du lundi au vendredi, de 8h à 18h",
  "calendar": { "provider": "calcom", "id": "123456" },
  "notify": { "email": ["contact@plomberie-dupont.fr"], "sms": ["33612345678"] },
  "voice": { "provider": "11labs", "voiceId": "..." }
}
```

## Quickstart

```bash
npm test                       # run the core unit tests (no dependencies, no keys)
cp .env.example .env           # fill in your keys
cp config/client.example.json config/client.json   # describe your client
# deploy api/ to a host that exposes /api/tools and /api/call-report (e.g. Vercel)
VAPI_PRIVATE_KEY=... WEBHOOK_BASE_URL=https://your-deploy node vapi/create-assistant.mjs
# then attach a phone number to the assistant in the Vapi dashboard and call it
```

A French `+33` number needs a Twilio or Telnyx regulatory bundle (ID plus a French address),
which takes a day or two. Start the demo on the number the platform gives you and get the `+33`
in parallel.

## Data and privacy

Short version: records live in **your** database; the platform is told to keep only metadata.
See [docs/DATA.md](docs/DATA.md) for the full flow, and [docs/PROVIDERS.md](docs/PROVIDERS.md)
for every swappable piece and the EU-sovereign option.

- The assistant **states it is an AI** in its first sentence (EU AI Act, article 50).
- Recording is **off** by default. Turn on the platform's **Zero Data Retention** so only your
  `/api/call-report` webhook persists the content, into your EU-hosted DB.
- Do not promise "data hosted in Europe" in writing until your voice platform confirms EU-only
  processing. For regulated data (health), prefer the self-hosted stack in `docs/PROVIDERS.md`.

## Status

- `src/core/` is covered by unit tests (`npm test`).
- The provider adapters are written against each vendor's documented API but need real keys to
  run end to end, and vendor schemas drift: verify against current docs before production. Each
  adapter says so at the top of its file.
