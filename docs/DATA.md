# Where the data lives

The question that decides the architecture: when a call happens, is the caller's data stored only
in our database, or also in the voice platform?

## The flow

1. The caller speaks. The platform (Vapi) runs the realtime loop: speech-to-text, the model, the
   voice. Audio and transcript pass **through** the platform in real time.
2. During the call, the agent calls our tools on `/api/vapi`. `noter_demande` and `prendre_rdv`
   write the caller's details into **our database**; `prendre_rdv` also books in the **calendar**.
3. At the end, the platform posts an **end-of-call report** to the same endpoint. We merge what the
   tools captured with the platform's summary and the caller ID, store the final call record in
   **our database**, and send the owner one recap.

The caller's details and the appointment end up in our database because our webhook writes them
there, during the call. That never depends on the platform's own data features.

## What our database keeps

Three tables, created by `migrations/0001_init.sql` in Cloudflare D1:

- **`calls`**, one row per call, keyed by the platform's call id: name, need, urgency, phone
  (international form), email, the town and address of the job, whether the details are complete, the status (`rdv` or
  `a_rappeler`), the urgent flag, the two slots offered as options 1 and 2, the platform's summary,
  a note when the calendar failed, `recap_sent_at`, and `deliveries`: what was sent to whom after
  the call (the caller's confirmation SMS, the owner's recap by email and by SMS), each marked sent,
  failed with the provider's message, or skipped with the reason.
- **`appointments`**, one row per booking: the call it came from, the UTC start, the French label sent
  to the caller, the caller's details with the town and address of the job, and the calendar's
  booking reference.
- **`call_attempts`**, one row per incoming call the screen saw: the caller's number (empty when
  withheld), the time, allowed or refused and why, and Twilio's or Vapi's call id. It holds phone
  numbers, so the retention period applies to it too.

Two guarantees come from this shape:

- **One booking per call.** A repeated booking request finds the existing appointment and confirms it
  instead of booking again.
- **One recap per call.** `recap_sent_at` is set once the owner recap reached at least one
  recipient, so a redelivered end-of-call report sends nothing. A recap that reached nobody leaves it
  unset: a redelivered report tries again, and the daily check reports it.

## What the platform keeps

By default the voice platform stores call artifacts on its side: transcript, summary, structured
data, logs, and the audio recording if recording is on.

- Recording is **off** in this project (`artifactPlan.recordingEnabled = false`).
- Transcript, summary and logs still sit on the platform **unless** you enable **Zero Data
  Retention**. With it on, Vapi keeps only metadata: call id, timestamps, duration, cost.

Because our tools capture the caller's details during the call, turning on Zero Data Retention loses
nothing we need. Only the summary in the owner recap would go.

## Hosting the database on Cloudflare D1 (free tier)

Create the database with an EU location so the records sit in Europe:

```bash
npx wrangler d1 create open-receptionist --location weur
```

`weur` is Western Europe. Because `src/db/d1.mjs` implements the same interface as the in-memory
store, nothing else in the codebase knows the database is D1. The tests run the real migration and
the store's SQL on SQLite, which D1 is built on.

## Retention

RGPD requires a defined retention period. Decide one with each client, 12 months by default, and set
it in `RETENTION_DAYS` (30 days to 5 years). Every morning the Worker deletes the calls, appointments
and screened calls older than that, and logs how many rows went. A value out of bounds is ignored,
12 months apply, and the daily check reports it.

## The honest caveat

Zero Data Retention removes **storage** on the platform. It does not remove **processing**: the audio
still transits the platform's realtime pipeline, and for Vapi that pipeline is not guaranteed to run
in the EU only. For a plumber or a restaurant this is defensible with the AI disclosure at the start
of the call, a CNIL information line, recording off, data minimisation and a data processing
agreement. For regulated or health data, use the self-hosted stack in [PROVIDERS.md](PROVIDERS.md),
where you own every hop.

## The rule this encodes

Keep the business records in a database you control, hosted where you need them, and let the voice
platform retain nothing. If you change platform, your data and your flows come with you, because
they were never inside it.
