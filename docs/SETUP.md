# Production setup, from zero

This guide takes you from nothing to a receptionist answering real calls for one business: a
French phone number, bookings in the business's calendar, a confirmation SMS to each caller, and a
recap to the owner after every call.

It assumes you host the service in your own accounts. If the client owns the accounts instead, see
[If the client owns the accounts](#if-the-client-owns-the-accounts) before you start.

Plan about three hours of work, plus one to three days for the French number's regulatory check.

## What it costs to run

| Item | Cost |
|---|---|
| Cloudflare Workers and D1 | free tier; the $5 a month plan (10 million requests) is recommended in production, see step 3.6 |
| Cal.com | free plan, or self-hosted |
| Resend, for the email recap | free tier |
| A French phone number from Twilio | about $1.35 a month |
| Vapi calls, with speech-to-text, gpt-4o-mini, an ElevenLabs voice and Twilio's incoming minutes | about $0.10 a minute; detail per item and per business in the [README](../README.md#what-it-costs-to-run) |
| SMS through Twilio | $0.0798 per SMS to France; Brevo, the alternative, from €0.045 |

Prices checked in October 2026. Check them again before quoting a client.

## 0. Before you start

**On your machine:** Node.js 20 or later, git, and a terminal. On Windows, Git Bash runs every
command below as written; PowerShell variants are given where the syntax differs.

**From the client, in writing:**

- the company name, the trade, the opening hours, and the phone number customers can call back on;
- who receives the recap after each call: at least one email address, the record of every call,
  and optionally mobile numbers for an SMS on top;
- what callers may be told: the services, what they do not do, the towns they serve, and their
  published rates (call-out fee, hourly rate, flat prices, whether the quote is free, and the page
  where the rates are online). Home-repair trades must give these prices before any work (arrêté du
  24 janvier 2017), so most already have them written down. Add the payment methods and a few common
  questions with their answers;
- the appointment type: its name, its duration, the buffer between visits, and how much notice
  they need before an appointment;
- the calendar the bookings should land in;
- what the receptionist must say in an emergency, validated by them. The plumbing example in
  `config/client.example.json` covers a gas smell and a major leak. The gas emergency number depends
  on who runs the gas network where they work, see [FLOWS.md](FLOWS.md#3-an-emergency);
- whether they keep their current number and forward calls to the receptionist, or publish a new one.

### If the client owns the accounts

Follow the same steps with accounts in the client's name. The client creates each account and
either gives you access or creates the keys for you. For Cloudflare, ask them for an API token
limited to **Workers Scripts: Edit** and **D1: Edit** on their account, and use it instead of
`wrangler login`:

```bash
export CLOUDFLARE_API_TOKEN=...      # the client's scoped token
export CLOUDFLARE_ACCOUNT_ID=...     # the client's account id
```

The client then pays the usage directly, and you invoice the setup and the maintenance.

## 1. Accounts

Create each account once. Keep every key in a password manager, never in a file inside the
repository.

### 1.1 Cloudflare

A free account is enough. If you want the receptionist on your own domain later, add that domain to
Cloudflare as well.

### 1.2 Cal.com

1. Create the account and connect the calendar the bookings should land in, such as Google Calendar.
2. Create an event type, for example "Intervention plomberie", with the duration, the working hours
   and a buffer between visits.
3. In **Limits**, set the **minimum notice**. Same-day emergencies need it short. A 24-hour notice
   sends every emergency to the call-back path instead of a same-day slot.
4. In the **booking questions**, make the **phone number required and the email optional**.
   Otherwise callers who only give a phone number cannot be booked.
5. Note the event type's numeric id, and create an API key under **Settings > Developer > API keys**.

Steps 2 to 5 can also be done by a script, once the API key exists and the calendar is connected:

```bash
npm run cal:setup
```

It asks for the API key, masked: the copy set with `wrangler secret put` cannot be read back, only the
deployed Worker sees it. The key is used for this run only, never stored or printed.

It creates an "Intervention" event type (one hour, 30 minutes after for the road, bookable one hour
ahead, phone required and email optional), or keeps the one already there, and writes its id into
`wrangler.toml` and `config/client.json`. Options: `-- --title="Visite de devis" --minutes=30
--buffer=15 --notice=0`. The working hours stay to set in Cal.com (**Availability**).

### 1.3 Vapi

1. Create the account and add a payment method: the trial credit runs out after a few test calls.
2. Copy the **private** API key.
3. Set a monthly spending limit or alert if your plan offers one.

### 1.4 The French phone number, at Twilio or Telnyx

1. Create the account and add a payment method.
2. Submit the **regulatory bundle** France requires, usually the business's identity and a proof of
   a French address. Validation takes one to three business days.
3. Buy a **geographic number** in the business's area, for example an `05` number for Bordeaux.
   Mobile numbers (`06`, `07`) come with stricter rules and are usually not the right fit.
4. Keep the account's id and token: Vapi needs them to import the number, and at Twilio the same
   pair sends the SMS (step 1.6).

To test before the number is approved, use a free Vapi number, as described in step 5.

### 1.5 Resend, for the owner's email recap

1. Add the sending domain and publish the DNS records Resend lists (SPF and DKIM, plus DMARC if the
   domain has none).
2. Wait until the domain shows as verified, then create an API key limited to sending.

### 1.6 SMS: Twilio, or Brevo

The Worker texts through **Twilio** when both `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set,
otherwise through **Brevo** when `BREVO_API_KEY` is set. Use one of them.

**Twilio**, the simplest when the number is at Twilio too (step 1.4):

1. **Upgrade the account** from the trial. A trial account only texts the numbers you verified, from
   a shared trial number, with a "Sent from a Twilio trial account" prefix, and cannot use a sender
   name.
2. Turn on **automatic recharge** of the balance: at zero, every SMS stops.
3. Choose the sender name: the business's short name, 3 to 11 letters or digits with at least one
   letter, such as `Dupont`. In France it needs no registration. Carriers filter generic names such
   as `Info` or `Accueil`, and the configuration check refuses them.
4. Copy the **Account SID** and the **Auth Token** from the Console.

**Brevo**, the alternative:

1. **Turn off Brevo's IP blocking.** Brevo refuses API calls from unknown IP addresses (**Security >
   Authorised IPs**). It is on by default for accounts created since May 2024, and it switches itself
   on for older accounts after 30 days without a new IP. A Cloudflare Worker has no fixed IP address,
   so while the blocking is on, every SMS is refused. Click **Deactivate blocking**; if your main
   Brevo account must keep it, open a separate account for the receptionist.
2. Buy SMS credits and choose the sender name, as for Twilio.
3. Create an API key.

The daily check (step 3.5) calls the SMS provider every morning and emails you if it refuses the
credentials (with Brevo, often because the IP blocking came back) or if the credit runs low: a
Twilio balance under 5, or fewer than 20 Brevo credits.

## 2. Get the code and check it

```bash
git clone https://github.com/tonystechofficial/open-receptionist.git
cd open-receptionist
npm test        # 279 tests, nothing to install
```

## 3. Database and Worker

### 3.1 Create the database in Europe

```bash
npx wrangler login
npx wrangler d1 create open-receptionist --jurisdiction eu
npm run db:id
npm run db:init
```

`--jurisdiction eu` keeps the records stored and processed in the European Union, and it can only be
set when the database is created. A location hint such as `--location weur` is not enough: Cloudflare
does not guarantee it ([data location](https://developers.cloudflare.com/d1/configuration/data-location/)).

`npm run db:id` creates `wrangler.toml` from `wrangler.example.toml` the first time, finds the database
by its name with `wrangler d1 list`, and writes its id in place of `REPLACE_WITH_D1_DATABASE_ID`; it
warns when the database is not in the EU jurisdiction. `db:init` then answers `0001_init.sql ✅`, and
the database holds the `calls`, `appointments` and `call_attempts` tables.

`wrangler.toml` holds this deployment's values (the database id, then the `[vars]` of step 3.3), and git
ignores it, so they stay out of the repository. `wrangler.example.toml` is the template: after a
`git pull`, copy any new setting from it into `wrangler.toml`.

### 3.2 Set the secrets

`npm run secret:webhook` makes a random webhook secret (32 bytes), sets it on the Worker, and shows it
once: keep it, Vapi needs the same value in step 4. Then set the providers' keys:

```bash
npm run secret:webhook
npx wrangler secret put CALCOM_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
# or, to text through Brevo instead of Twilio: npx wrangler secret put BREVO_API_KEY
```

Each `secret put` asks for the value, stores it encrypted, and never shows it again.

### 3.3 Fill in the client's settings

```bash
npm run configure
```

It asks for each setting below, one at a time, with what it is for and an example, and checks every
answer with the rules the Worker applies when it starts. It refuses the template's example email,
phone numbers and ids: left in place, the recaps, with the callers' details, would go to whoever owns
them. At the end it writes the `[vars]` block of `wrangler.toml`, comments kept. Run it again whenever
a setting changes, then deploy. Editing the `[vars]` block by hand works too:

| Variable | What to put |
|---|---|
| `CLIENT_COMPANY` | the business name the receptionist says |
| `CLIENT_METIER` | the trade, for example `plomberie` |
| `CLIENT_HORAIRES` | the opening hours, in words |
| `CLIENT_TELEPHONE` | the number given to callers in the confirmation SMS |
| `CLIENT_ZONE` | the towns served, comma-separated: the same list as `infos.zone` in step 4.2. Empty means everywhere |
| `CLIENT_TARIFS_URL` | optional: the page with the published rates, linked at the end of the confirmation SMS |
| `TIME_ZONE` | `Europe/Paris` |
| `NOTIFY_EMAIL` | the recap recipients, comma-separated. Required: the email is the record of every call |
| `NOTIFY_SMS` | optional: mobile numbers (`06`, `07`) for an SMS recap, comma-separated, written as usual, such as `06 12 34 56 78`. A landline is refused |
| `CONFIRM_CALLER_SMS` | `true`, or `false` to stop texting callers |
| `CALCOM_EVENT_TYPE_ID` | the event type id from step 1.2 |
| `MAIL_FROM` | a sender on the verified Resend domain, such as `Accueil <accueil@yourdomain.fr>` |
| `SMS_SENDER` | the business's short name from step 1.6: 3 to 11 letters or digits with at least one letter, never a generic name such as `Info` or `Accueil`. Required when SMS is on |
| `ALERT_EMAIL` | who receives the daily check's alerts and the immediate flood alert, usually you. Defaults to the first `NOTIFY_EMAIL` |
| `TRANSFER_HOURS` | optional: when an emergency or a caller asking for a person may be put through to `transfert.numero` (step 4.2), Paris time, such as `lun-ven 8h-18h; sam 9h-12h30`. Empty: any hour, night included |
| `RETENTION_DAYS` | optional: how long call records are kept before the daily run deletes them. 365 by default, from 30 to 1825 |
| `CRM_WEBHOOK_URL` | optional: where the end of each call is sent, with the secret `CRM_WEBHOOK_SECRET` (docs/FLOWS.md, section 11). open-pipeline's `npm run link:receptionist` sets both. A CRM Worker on the same Cloudflare account also needs `compatibility_flags = ["global_fetch_strictly_public"]`, already in the template |

To keep the Worker's logs after each call, also add:

```toml
[observability]
enabled = true
```

### 3.4 Deploy

```bash
npm run deploy
```

It also writes `README.local.md`, ignored by git: the remaining steps with your Worker's own address in
every command (rewrite it with `npm run readme:local`). The first deploy asks you to choose a
`workers.dev` subdomain. Then check that the Worker answers:

```bash
curl https://open-receptionist.<your-subdomain>.workers.dev/health
# {"ok":true}
```

In PowerShell, type `curl.exe`: plain `curl` there is `Invoke-WebRequest`, which refuses `-H "name: value"`.

To serve it from your own domain instead, open the Worker in the Cloudflare dashboard, go to
**Settings > Domains & Routes**, and add a custom domain from a zone on your account.

### 3.5 Run the daily check once

```bash
curl -H "x-vapi-secret: <the webhook secret>" \
  https://open-receptionist.<your-subdomain>.workers.dev/api/check
# {"ok":true,"problems":[]}
```

In PowerShell, on one line:

```powershell
curl.exe -H "x-vapi-secret: <the webhook secret>" https://open-receptionist.<your-subdomain>.workers.dev/api/check
```

This is the check the `[triggers]` cron in `wrangler.toml` runs every morning, run now and without
emailing anything. Each problem comes back as a sentence: a configuration the Worker refuses, a missing
provider key, SMS credentials the provider refuses, SMS credit running low, or a confirmation SMS or recap that
failed in the last 24 hours. The morning run emails the same list to `ALERT_EMAIL`, only when there
is one, then deletes the records older than `RETENTION_DAYS`. Each call also keeps, in its
`deliveries` column, what was sent to whom and what failed.

### 3.6 Shield the endpoints against junk requests

A source hammering the Worker's public addresses cannot get past the secret or the signature, but
each request still counts against the daily allowance, and on the free plan 100,000 requests a day is
all there is: past it, real calls fail too. Two settings make that flood harmless:

1. **Serve the Worker from your own domain** (step 3.4): an edge rule needs a zone on your account;
   it cannot be put on `workers.dev`. Point Vapi and Twilio at the new address.
2. **Put the edge rule**, which blocks any address sending more than 50 requests in 10 seconds to the
   receptionist's endpoints, for 10 seconds: the most Cloudflare's free plan allows, and plenty for
   real traffic. With a token that has **Zone WAF: Edit** on that zone:
   ```bash
   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... npm run cf:rate-limit            # shows the rule
   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... npm run cf:rate-limit -- --apply # puts it
   ```
   Or in the dashboard: **Security > WAF > Rate limiting rules**, the same paths
   (`/api/vapi`, `/api/tools`, `/api/call-report`, `/api/twilio/voice`, `/api/check`), counted per IP,
   50 requests per 10 seconds, block for 10 seconds.
3. **Take the Workers plan at $5 a month** in production. A determined source still gets about a third
   of its requests through between blocks; 10 million requests a month absorb a full day of it, where
   the free plan's 100,000 a day would run out.

## 4. The Vapi assistant

**The short way:** once `config/client.json` is filled (step 4.2), put the Vapi private key in
`.env.local` (`VAPI_PRIVATE_KEY=...`, ignored by git) and run `npm run vapi:setup`. It does steps 4.1
and 4.3: a new `WEBHOOK_SECRET` on the Worker and in a Vapi credential sent as `X-Vapi-Secret`, then
the assistant, created the first time and updated after, with the ids and the secret kept in
`.env.local`, and a call to `/api/check` with that secret. The steps below do the same by hand.

### 4.1 Let Vapi authenticate to your Worker

In the Vapi dashboard, create a **Custom Credential** of type **Bearer Token** with:

- the header name `X-Vapi-Secret`;
- the webhook secret from step 3.2 as the value;
- **no** `Bearer` prefix.

Copy the credential's id, which starts with `cred_`.

### 4.2 Describe the client

```bash
cp config/client.example.json config/client.json
```

Fill it with the **same** company, trade, hours, phone and recipients as the `[vars]`, plus:

- `voice`: a French voice. An ElevenLabs French voice sounds far more natural than the default;
- `urgences`: the emergency instructions the client validated in writing, with the gas emergency
  number of their area;
- `infos`: what callers may be told, written as the client wants it said: `prestations`,
  `horsPrestations`, `zone` (the towns served, the same list as `CLIENT_ZONE`), `tarifs`
  (`deplacement`, `tauxHoraire`, `forfaits`, `devis`), `paiement`, `faq` and `tarifsUrl`. The agent
  reads them word for word and invents nothing else; see [FLOWS.md](FLOWS.md#15-questions-about-the-business-prices-and-the-service-area);
- `notify`, `smsSender` and `confirmation`, matching the Worker's settings. `notify.email` is required.
- `transfert`, optional: `{ "numero": "06 …" }`, the phone that takes an emergency or a caller asking
  for a person, within `TRANSFER_HOURS` (step 3.3). Without it, no call is ever put through.
- `parcours`, optional: `"intervention"` (the default: a job at the caller's) or `"decouverte"` (a
  service business booking a first exchange). The discovery journey reads `interlocuteur`,
  `presentation`, `echange`, `qualification`, `exemples` and `demonstration`: start from
  `config/client.decouverte.example.json`, and leave `CLIENT_ZONE` empty. See
  [FLOWS.md](FLOWS.md#17-the-discovery-journey-a-service-business-books-a-first-exchange).

`config/client.json` is ignored by git, like `wrangler.toml`. The Worker reads `wrangler.toml` and the assistant script
reads `config/client.json`, so change both whenever a setting changes.

### 4.3 Create the assistant

In Git Bash:

```bash
VAPI_PRIVATE_KEY=... VAPI_CREDENTIAL_ID=cred_... \
WEBHOOK_BASE_URL=https://open-receptionist.<your-subdomain>.workers.dev \
  node vapi/create-assistant.mjs config/client.json
```

In PowerShell:

```powershell
$env:VAPI_PRIVATE_KEY = "..."; $env:VAPI_CREDENTIAL_ID = "cred_..."
$env:WEBHOOK_BASE_URL = "https://open-receptionist.<your-subdomain>.workers.dev"
node vapi/create-assistant.mjs config/client.json
```

Note the assistant id it prints. To update the assistant later, run the same command with
`VAPI_ASSISTANT_ID` set to that id.

## 5. The phone number

1. **To test:** in Vapi, under **Phone Numbers**, take a free Vapi number and assign the assistant to
   inbound calls.
2. **For production:** import the Twilio or Telnyx number into Vapi with its account id and token,
   assign the assistant to inbound calls, then release the test number.
3. **If the business keeps its existing number,** set conditional call forwarding with its carrier:
   forward to the receptionist's number on no answer, on busy, and outside opening hours. On most
   French mobile lines the codes are `**61*<number>#` for no answer, `**67*<number>#` for busy and
   `**62*<number>#` for unreachable; landlines and internet boxes set it in the operator's interface.
   Test each case with a real call.

### 5.4 Screen incoming calls

Every minute is billed, so the Worker can turn a caller away before anything answers: a number in
`BLOCKED_NUMBERS`, a number already let through 4 times this hour or 8 times today, more than 5
withheld numbers in the hour, or more than 30 calls in the hour in total (all adjustable in
`[vars]`). A refused caller always hears how to reach help in an emergency. Set up **one** of the two
methods, never both, or each call is counted twice.

**Method 1, the number is at Twilio (recommended).** Twilio asks the Worker first, and a refused call
never reaches Vapi: a blocked number is rejected without being answered, so nobody bills it, and a
limited caller hears one sentence before the line closes.

1. Import the number into Vapi first (item 2 above): the import sets Twilio's webhook to Vapi's.
2. In the Twilio Console, open the number, and under **Voice > A call comes in**, set the webhook to
   `https://open-receptionist.<your-subdomain>.workers.dev/api/twilio/voice`, method `POST`.
3. Keep `TWILIO_AUTH_TOKEN` set: the Worker reads only requests signed with it.

Allowed calls are redirected to `https://api.vapi.ai/twilio/inbound_call`, the webhook Vapi itself
sets, so Vapi answers as before. Re-importing the number into Vapi puts Vapi's webhook back: redo
step 2 afterwards.

**Method 2, any number (a Vapi number, Telnyx).** Vapi asks the Worker which assistant answers.

1. Set `VAPI_ASSISTANT_ID` in `[vars]` to the id printed in step 4.3, and deploy.
2. In Vapi, open the phone number: remove its assistant, and set its **Server URL** to
   `https://open-receptionist.<your-subdomain>.workers.dev/api/vapi` with the credential from step 4.1.

A refused caller hears the reason spoken by Vapi, a few seconds of billed time.

Every screened call is written to the `call_attempts` table, and the daily check sums up the refused
ones. If the screen itself breaks, calls are let through rather than lost.

## 6. Go-live checklist

Run `npm run cf:tail` in a terminal to watch the Worker, then call and tick each line:

- [ ] The receptionist says it is an AI in its first sentence.
- [ ] It offers to call you back on the number you are calling from.
- [ ] Asked for an appointment, it offers two slots in natural French, in Paris time.
- [ ] The log shows a `tool-calls` POST to `/api/vapi` answered with status 200.
- [ ] The booking appears in Cal.com and in the connected calendar.
- [ ] The confirmation SMS arrives once. Called from a landline, the receptionist promises none.
- [ ] After you hang up, the owner receives the recap email and SMS once.
- [ ] Saying « ça sent le gaz » triggers the safety instructions before any booking.
- [ ] The call is in the database, and its `deliveries` show every message as `sent`:
  ```bash
  npx wrangler d1 execute open-receptionist --remote \
    --command "SELECT call_id, status, nom, telephone, deliveries FROM calls ORDER BY created_at DESC LIMIT 5"
  ```
- [ ] `/api/check`, from step 3.5, answers `{"ok":true,"problems":[]}`.
- [ ] With screening on (step 5.4), your test calls appear in `call_attempts` as `allowed`, and a
  number added to `BLOCKED_NUMBERS` is refused.

Then turn on **Zero Data Retention** in Vapi's organisation settings. The caller's details keep
flowing through your tools into your database; only Vapi's own copy of the call goes away. Make one
more test call to confirm the recap still arrives. If its summary line disappears, that is the
effect of Zero Data Retention, not a fault.

## 7. Compliance, before real customers call

- **AI disclosure.** The first sentence says the receptionist is an AI, as article 50 of the EU AI
  Act requires. Do not remove it.
- **Caller information.** The business's privacy policy must describe this processing: its purpose,
  who receives the data, how long it is kept, and how to object or ask for access, as the CNIL
  expects.
- **Contract.** Sign a data processing agreement with the client: you process their customers'
  data. List your sub-processors: Vapi and the speech, model and voice providers it uses, the
  telephony provider, Cloudflare, Cal.com, Resend, and the SMS provider, Twilio or Brevo.
- **Retention.** Agree on a period with the client, 12 months by default, and set it in
  `RETENTION_DAYS` (30 to 1825). Every morning the Worker deletes the calls, appointments and
  screened calls older than that; the Worker's log shows how many rows went.
- **Data location.** The database is in the EU, but the voice platform's real-time processing is not
  guaranteed to stay in the EU. Do not promise "data hosted in Europe" in writing.
- **Emergency wording.** Keep the client's written validation of the `urgences` text.
- **Recording.** Leave it off unless the client needs it and informs callers.

## 8. Running it

| Task | How |
|---|---|
| Watch calls live | `npm run cf:tail`, or Workers Logs in the dashboard |
| Ship an update | `git pull`, `npm test`, `npm run db:init` to apply any new migration, copy any new setting of `wrangler.example.toml` into `wrangler.toml`, then `npm run deploy` |
| Undo a bad deploy | `npx wrangler rollback` |
| Change a setting | edit `[vars]` and `config/client.json`, run `npm run deploy`, then re-run the assistant script with `VAPI_ASSISTANT_ID` |
| Rotate the webhook secret | `npm run secret:webhook` and update the Vapi credential **at the same time**: calls fail in between |
| Rotate another key | `npx wrangler secret put <NAME>`; it takes effect without a separate deploy |
| Back up the database | `npx wrangler d1 export open-receptionist --remote --output backup.sql`; D1's point-in-time restore also covers recent days, depending on your plan |
| Find failed messages | the daily check emails them; to look yourself: `npx wrangler d1 execute open-receptionist --remote --command "SELECT call_id, deliveries FROM calls WHERE deliveries LIKE '%failed%' ORDER BY updated_at DESC LIMIT 20"` |
| Block a number | add it to `BLOCKED_NUMBERS` in `[vars]`, then `npm run deploy` |
| See refused calls | the daily check sums them up; to look yourself: `npx wrangler d1 execute open-receptionist --remote --command "SELECT number, at, reason, via FROM call_attempts WHERE decision = 'refused' ORDER BY at DESC LIMIT 20"` |
| Watch costs | Vapi minutes, the SMS balance (the daily check warns under 5 at Twilio, or under 20 Brevo credits), the number's rental |

## 9. Limits of this version

- One business per deployment. A second client needs a second Worker and database, until the
  multi-client version.
- No dashboard yet. Read calls from the recaps or with the database query in step 6.
- The receptionist cannot move or cancel an existing booking. It takes a message for a call-back.
- Google Calendar is reached through Cal.com, not directly.
- On the Node/Vercel entry, nothing runs every morning: the daily check, the retention purge and the
  call screening's Twilio method are Worker-only.

Every call flow is described in [FLOWS.md](FLOWS.md), where the data lives in [DATA.md](DATA.md),
and the swappable pieces in [PROVIDERS.md](PROVIDERS.md).
