# Where the data lives

The question that decides the architecture: when a call happens, is the caller's data stored
only in our database, or also in the voice platform?

## The flow

1. The caller speaks. The platform (Vapi) runs the realtime loop: speech-to-text, the model, the
   voice. Audio and transcript pass **through** the platform in real time.
2. During the call, the model calls our tools (`/api/tools`): read availability, book a slot. The
   booking is written to the **calendar** and to **our database**.
3. At the end, the platform posts an **end-of-call report** to `/api/call-report`. We extract the
   structured fields, run them through `qualify`, and persist the call record in **our database**,
   then send the recap by email and SMS.

So the appointment and the caller record always end up in **our database**, because our webhook
writes them there. That part never depends on the platform.

## What the platform keeps

By default the voice platform stores call artifacts on its side: transcript, summary, structured
data, logs, and the audio recording if recording is enabled.

- Recording is **off** in this project (`artifactPlan.recordingEnabled = false`), so there is no
  stored audio.
- Transcript, summary, structured data and logs still sit on the platform **unless** you enable
  **Zero Data Retention (ZDR)**.

With ZDR on, the platform keeps only **metadata**: call id, timestamps, duration, cost, latency.
The content is not retained. That is exactly why `/api/call-report` is mandatory: with ZDR on, our
webhook is the **only** place the call content survives. Miss it and the content is gone.

## The honest caveat

ZDR removes **storage** on the platform. It does not remove **processing**: the audio still
transits the platform's realtime pipeline, and for Vapi that pipeline is not guaranteed to run in
the EU only. Processing is not storage, but for an RGPD posture it matters:

- For a plumber or a restaurant (no sensitive data), this is defensible with: the AI disclosure at
  the start of the call (AI Act article 50), a CNIL information line, recording off, data
  minimization, and a data processing agreement.
- For regulated or health data, do not rely on a US-routed platform. Use the self-hosted,
  EU-hosted stack in [PROVIDERS.md](PROVIDERS.md), where you own every hop.

## Hosting the database on Cloudflare D1 (free tier)

The default deployment stores records in **Cloudflare D1**, a SQLite database on Cloudflare's free
tier (`src/db/d1.mjs`, schema in `migrations/0001_init.sql`). Create it with an EU location so the
records sit in Europe:

```bash
npx wrangler d1 create open-receptionist --location weur
```

`weur` is Western Europe. This addresses the storage side of the RGPD posture: the appointment and
call records live in an EU-hosted database you control. It does not change the caveat above about
the voice platform's realtime processing, which is a separate hop.

Because `src/db/d1.mjs` implements the same `{ saveCall, saveAppointment, all }` interface as the
file store, nothing else in the codebase knows or cares that the database is D1.

## The rule this encodes

Keep the business records in a database you control and host where you need them. Treat the voice
platform as transport that should retain nothing. If you ever change platform, your data and your
logic come with you, because they were never inside it.
