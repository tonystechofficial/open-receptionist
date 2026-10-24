# open-receptionist

A provider-agnostic **AI phone receptionist** for small businesses. It answers in French, says it
is an AI, qualifies the caller, offers two real slots from the calendar, books the one chosen, texts
the caller a confirmation and sends the owner a recap.

One architectural choice drives everything: **your database is the source of truth, and the voice
platform is replaceable transport.** The flows, the per-client config and the stored records never
depend on Vapi. Swap the voice layer for Retell, Bland, Telnyx or a self-hosted LiveKit/Pipecat
stack without touching the core.

Maintained by Tony's Tech. MIT licensed.

What the product must do, and must never do, is in [docs/SPEC.md](docs/SPEC.md): the target, the hard
constraints on safety, cost, security and data, the non-goals, and when it counts as done.

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
  "infos": {
    "prestations": ["recherche et réparation de fuite", "débouchage", "..."],
    "zone": ["Bordeaux", "Mérignac", "Pessac", "..."],
    "tarifs": { "deplacement": "49 € TTC, offert si les travaux sont réalisés", "devis": "gratuit, remis avant les travaux" },
    "tarifsUrl": "https://plomberie-dupont.fr/tarifs"
  },
  "urgences": "Odeur de gaz : ... le 05 56 79 41 00 de Régaz-Bordeaux ..., sinon Urgence Sécurité Gaz au 0 800 47 33 33 ..."
}
```

The agent answers questions about the business word for word from `infos`, states the call-out fee
once before booking, never quotes a specific job, and books only in the towns served
([how, in the call](docs/FLOWS.md#15-questions-about-the-business-prices-and-the-service-area)).

## Quickstart

```bash
npm test     # 224 tests: core, flows, D1 SQL on SQLite, Worker routing and daily check. No dependencies, no keys.
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

## What it costs to run

About **$0.10 per minute of call**, all included. Prices checked in October 2026, excluding VAT:

| Item | Price |
|---|---|
| Vapi hosting | $0.05 a minute |
| ElevenLabs voice, through Vapi (no ElevenLabs subscription) | $0.015 to $0.024 a minute |
| Twilio, incoming call on a French number | $0.010 a minute |
| Deepgram speech-to-text, through Vapi | about $0.010 a minute |
| gpt-4o-mini, through Vapi | about $0.008 a minute |
| Twilio French number | $1.35 a month |
| Twilio SMS to France | $0.0798 each |
| Cloudflare Workers and D1, Cal.com, Resend (up to 3,000 emails a month) | free |
| Cloudflare Workers plan, recommended in production against junk-request floods | $5 a month for 10 million requests |

Per business and per month, with 2-minute calls and a confirmation SMS for each booking:

| | Small | Typical | Busy |
|---|---|---|---|
| Calls / minutes | 60 / 120 | 150 / 300 | 400 / 800 |
| Bookings, so confirmation SMS | 40 | 100 | 250 |
| **Total** | **about $17** | **about $40** | **about $101** |

An SMS recap to the owner after every call adds $0.08 a call. Shared by every business on the same
accounts: Vapi's simultaneous calls (4 on pay-as-you-go, 10 with Core at $29 a month, $10 per extra
line), Resend past 3,000 emails a month or 100 a day ($20 a month), and an ElevenLabs plan, needed only
for a cloned voice on your own key. Sources: [Vapi](https://vapi.ai/pricing),
[ElevenLabs](https://elevenlabs.io/pricing/api), [Deepgram](https://deepgram.com/pricing),
[Twilio voice](https://www.twilio.com/en-us/voice/pricing/fr),
[Twilio SMS](https://www.twilio.com/en-us/sms/pricing/fr), [Resend](https://resend.com/pricing).

## Security and limits

**Call length, so cost:**

- Every call is cut at **5 minutes** (`maxDurationSeconds`) and after **30 seconds of silence**
  (`silenceTimeoutSeconds`). A client can lower both; the configuration check refuses a cap over 30
  minutes or a silence timeout over 2 minutes, so a typo cannot leave the meter running.
- The agent **hangs up by itself** (Vapi's `endCall` tool) once the caller has no more questions, or
  on an abusive or prank call. It never hangs up during an emergency.
- Vapi runs **at most 4 calls at once** on pay-as-you-go (10 with Core): a flood of calls costs at
  most that many minutes at a time.
- The **daily check** reports every call cut at the time cap, any number that called 5 times or more
  in 24 hours, and the calls the screen refused.

**Call screening, before anything answers** ([SETUP, step 5.4](docs/SETUP.md#54-screen-incoming-calls)):

- A number in `BLOCKED_NUMBERS`, a number already let through 4 times this hour or 8 times today, more
  than 5 withheld numbers in the hour, or more than 30 calls in the hour in total is turned away. A
  refused caller always hears how to reach help in an emergency (112).
- **Method 1, number at Twilio:** Twilio asks the Worker first (`/api/twilio/voice`, signature checked
  with the account's Auth Token). A blocked number is rejected without being answered, so nobody
  bills it; a limited caller hears one sentence; Vapi never sees either. Allowed calls go on to Vapi.
- **Method 2, any number:** Vapi asks the Worker which assistant answers (`assistant-request`); a
  refused caller hears the reason in a few billed seconds.
- If the screen itself breaks, calls are let through rather than lost.
- When a wave starts being turned away (the hourly total, or too many withheld numbers), the operator
  gets an email at once, once per hour, without waiting for the daily report.

**Junk requests to the endpoints** ([SETUP, step 3.6](docs/SETUP.md#36-shield-the-endpoints-against-junk-requests)):

- They cannot get past the secret or the signature, and are refused before any data or provider is
  touched. To keep a flood from eating the daily request allowance: serve the Worker from your own
  domain, put the edge rule (`npm run cf:rate-limit`: more than 50 requests in 10 seconds from one
  address are blocked), and take the $5 Workers plan in production.

**SMS:**

- Confirmations go only to mobiles in the countries listed in `SMS_COUNTRIES`, France by default. A
  caller can dictate any number, and SMS to some countries cost many times the French rate (SMS
  pumping fraud): a dictated foreign number gets no SMS.

**The webhooks:**

- Every call to `/api/vapi` must carry the shared secret (`X-Vapi-Secret`, sent by a Vapi credential),
  or it gets a 401; `/api/twilio/voice` must carry Twilio's signature, or it gets a 403. Both are
  compared in constant time. `/api/check` needs the secret; `/health` only answers `{"ok":true}`.
- The keys are Cloudflare secrets: never in the repository, never in a browser.

**What a caller can make the agent do:**

- Three tools only: note a request, read two free slots, book one. It cannot cancel or move a booking,
  read other customers' data, or text anyone but the caller (once, after a booking) and the owner.
- Everything the caller says is a request, never an instruction, and the prompt holds no secret.

**In the providers' dashboards** (settings, not code):

- **Vapi:** keep the balance prepaid with auto-reload off or capped, so a flood cannot spend more than
  the credit, and do not buy concurrency lines you do not need.
- **Twilio:** cap the automatic recharge; in Voice geographic permissions turn **off** every outbound
  destination (the receptionist never calls out, and leaked keys could otherwise run up international
  calls); in Messaging geographic permissions allow **France only**; add a usage trigger that emails
  you past a daily amount.
- **Every account** (Cloudflare, Vapi, Twilio, Cal.com, Resend, GitHub): two-factor authentication.
  Keys with the least rights: a Resend key limited to sending, a Cloudflare token limited to the
  Worker and D1.

**Old records:** every morning the Worker deletes the calls, appointments and screened calls older
than `RETENTION_DAYS`, 12 months by default (30 days to 5 years).

What the product must do and must never do is the contract in [docs/SPEC.md](docs/SPEC.md).

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
  real SQLite, the Twilio and Brevo adapters, the call limits, call screening by both methods, the flood
  alert, the retention purge, the edge rule's plan, the business information and the service area,
  and the Worker's routing, authentication, fallback and daily check (224 tests).
- **Only a real call proves:** that Vapi fills in `{{customer.number}}` and delivers tool calls, that
  your Cal.com event type accepts phone-only bookings, and that SMS and email are delivered. The
  checklist in docs/FLOWS.md walks through each.
- Vendor APIs drift. The adapters name the documentation and the date they were checked against.
