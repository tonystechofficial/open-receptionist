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
| Cloudflare Workers and D1 | free tier |
| Cal.com | free plan, or self-hosted |
| Resend, for the email recap | free tier |
| A French phone number from Twilio | about $1.35 a month |
| Vapi calls, speech, model and voice included | about $0.10 to $0.30 a minute |
| Brevo SMS | prepaid credits, charged per message |

Prices checked in October 2026. Check them again before quoting a client.

## 0. Before you start

**On your machine:** Node.js 20 or later, git, and a terminal. On Windows, Git Bash runs every
command below as written; PowerShell variants are given where the syntax differs.

**From the client, in writing:**

- the company name, the trade, the opening hours, and the phone number customers can call back on;
- who receives the recap after each call: at least one email address, the record of every call,
  and optionally mobile numbers for an SMS on top;
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
4. Keep the account's id and token: Vapi needs them to import the number.

To test before the number is approved, use a free Vapi number, as described in step 5.

### 1.5 Resend, for the owner's email recap

1. Add the sending domain and publish the DNS records Resend lists (SPF and DKIM, plus DMARC if the
   domain has none).
2. Wait until the domain shows as verified, then create an API key limited to sending.

### 1.6 Brevo, for SMS

1. **Turn off Brevo's IP blocking.** Brevo refuses API calls from unknown IP addresses (**Security >
   Authorised IPs**). It is on by default for accounts created since May 2024, and it switches itself
   on for older accounts after 30 days without a new IP. A Cloudflare Worker has no fixed IP address,
   so while the blocking is on, every SMS is refused. Click **Deactivate blocking**; if your main
   Brevo account must keep it, open a separate account for the receptionist.
2. Buy SMS credits and choose the sender name: the business's short name, 3 to 11 letters or digits,
   such as `Dupont`. Carriers filter generic names such as `Info` or `Accueil`, and the configuration
   check refuses them.
3. Create an API key.

The daily check (step 3.5) calls Brevo with this key every morning and emails you if Brevo refuses
it, for example because the blocking came back, or if the SMS credits run low.

## 2. Get the code and check it

```bash
git clone https://github.com/tonystechofficial/open-receptionist.git
cd open-receptionist
npm test        # 126 tests, nothing to install
```

## 3. Database and Worker

### 3.1 Create the database in Europe

```bash
npx wrangler login
npx wrangler d1 create open-receptionist --location weur
```

Copy the `database_id` printed by the second command into `wrangler.toml`, then create the tables:

```bash
npm run db:init
```

### 3.2 Set the secrets

Generate a long random webhook secret and keep it: Vapi needs the same value in step 4.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put CALCOM_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put BREVO_API_KEY
```

Each `secret put` asks for the value, stores it encrypted, and never shows it again.

### 3.3 Fill in the client's settings

Edit the `[vars]` block of `wrangler.toml`:

| Variable | What to put |
|---|---|
| `CLIENT_COMPANY` | the business name the receptionist says |
| `CLIENT_METIER` | the trade, for example `plomberie` |
| `CLIENT_HORAIRES` | the opening hours, in words |
| `CLIENT_TELEPHONE` | the number given to callers in the confirmation SMS |
| `TIME_ZONE` | `Europe/Paris` |
| `NOTIFY_EMAIL` | the recap recipients, comma-separated. Required: the email is the record of every call |
| `NOTIFY_SMS` | optional: mobile numbers (`06`, `07`) for an SMS recap, comma-separated, written as usual, such as `06 12 34 56 78`. A landline is refused |
| `CONFIRM_CALLER_SMS` | `true`, or `false` to stop texting callers |
| `CALCOM_EVENT_TYPE_ID` | the event type id from step 1.2 |
| `MAIL_FROM` | a sender on the verified Resend domain, such as `Accueil <accueil@yourdomain.fr>` |
| `SMS_SENDER` | the business's short name from step 1.6, never a generic name such as `Info` or `Accueil`. Required when SMS is on |
| `ALERT_EMAIL` | who receives the daily check's alerts, usually you. Defaults to the first `NOTIFY_EMAIL` |

To keep the Worker's logs after each call, also add:

```toml
[observability]
enabled = true
```

### 3.4 Deploy

```bash
npm run deploy
```

The first deploy asks you to choose a `workers.dev` subdomain. Then check that the Worker answers:

```bash
curl https://open-receptionist.<your-subdomain>.workers.dev/health
# {"ok":true}
```

To serve it from your own domain instead, open the Worker in the Cloudflare dashboard, go to
**Settings > Domains & Routes**, and add a custom domain from a zone on your account.

### 3.5 Run the daily check once

```bash
curl -H "x-vapi-secret: <the webhook secret>" \
  https://open-receptionist.<your-subdomain>.workers.dev/api/check
# {"ok":true,"problems":[]}
```

This is the check the `[triggers]` cron in `wrangler.toml` runs every morning, run now and without
emailing anything. Each problem comes back as a sentence: a configuration the Worker refuses, a missing
provider key, an SMS key Brevo refuses, SMS credits running low, or a confirmation SMS or recap that
failed in the last 24 hours. The morning run emails the same list to `ALERT_EMAIL`, only when there
is one. Each call also keeps, in its `deliveries` column, what was sent to whom and what failed.

## 4. The Vapi assistant

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
- `notify`, `smsSender` and `confirmation`, matching the Worker's settings. `notify.email` is required.

`config/client.json` is ignored by git. The Worker reads `wrangler.toml` and the assistant script
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
  telephony provider, Cloudflare, Cal.com, Resend and Brevo.
- **Retention.** Agree on a period, for example twelve months, and delete older rows. There is no
  automatic purge yet:
  ```bash
  npx wrangler d1 execute open-receptionist --remote \
    --command "DELETE FROM appointments WHERE created_at < date('now','-12 months')"
  npx wrangler d1 execute open-receptionist --remote \
    --command "DELETE FROM calls WHERE created_at < date('now','-12 months')"
  ```
- **Data location.** The database is in the EU, but the voice platform's real-time processing is not
  guaranteed to stay in the EU. Do not promise "data hosted in Europe" in writing.
- **Emergency wording.** Keep the client's written validation of the `urgences` text.
- **Recording.** Leave it off unless the client needs it and informs callers.

## 8. Running it

| Task | How |
|---|---|
| Watch calls live | `npm run cf:tail`, or Workers Logs in the dashboard |
| Ship an update | `git pull`, `npm test`, `npm run db:init` to apply any new migration, then `npm run deploy` |
| Undo a bad deploy | `npx wrangler rollback` |
| Change a setting | edit `[vars]` and `config/client.json`, run `npm run deploy`, then re-run the assistant script with `VAPI_ASSISTANT_ID` |
| Rotate the webhook secret | `npx wrangler secret put WEBHOOK_SECRET` and update the Vapi credential **at the same time**: calls fail in between |
| Rotate another key | `npx wrangler secret put <NAME>`; it takes effect without a separate deploy |
| Back up the database | `npx wrangler d1 export open-receptionist --remote --output backup.sql`; D1's point-in-time restore also covers recent days, depending on your plan |
| Find failed messages | the daily check emails them; to look yourself: `npx wrangler d1 execute open-receptionist --remote --command "SELECT call_id, deliveries FROM calls WHERE deliveries LIKE '%failed%' ORDER BY updated_at DESC LIMIT 20"` |
| Watch costs | Vapi minutes, Brevo credits (the daily check warns below 20), the number's rental |

## 9. Limits of this version

- One business per deployment. A second client needs a second Worker and database, until the
  multi-client version.
- No dashboard yet. Read calls from the recaps or with the database query in step 6.
- The receptionist cannot move or cancel an existing booking. It takes a message for a call-back.
- Google Calendar is reached through Cal.com, not directly.
- Data retention is applied by hand.

Every call flow is described in [FLOWS.md](FLOWS.md), where the data lives in [DATA.md](DATA.md),
and the swappable pieces in [PROVIDERS.md](PROVIDERS.md).
