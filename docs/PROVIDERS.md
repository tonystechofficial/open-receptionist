# Swappable providers

Every external piece sits behind a small interface in `src/providers/`, so you can change vendor
without touching the business logic. This file lists the options.

## Voice platform (the realtime loop)

The realtime loop is telephony plus speech-to-text plus the model plus the voice, with barge-in
and low latency. Two ways to get it.

### Drop-in platforms (fastest)

| Platform | Notes |
|---|---|
| **Vapi** | Implemented here (`src/providers/voice/vapi.mjs`). Number, tools, webhooks, structured data. |
| **Retell AI** | Stub here. Same shape: agent, tools, post-call webhook. |
| **Bland AI** | Phone-first, enterprise leaning. |
| **Synthflow** | More no-code, built-in calendar and number. |
| **Telnyx Voice AI** | Telephony vendor with a voice-agent layer and EU numbers. |

All of them follow the same pattern: a number, function tools during the call, a webhook at the
end. That is why the adapter interface is `buildAssistant`, `getToolCalls`, `extractStructuredData`,
`isEndOfCall`, `verifySecret`.

### Self-hosted, EU-sovereign (full data control)

Assemble the loop yourself when you must own every hop (regulated data, strict RGPD):

- **Framework:** LiveKit Agents or Pipecat (both open source, self-hostable).
- **Telephony / number:** Twilio, Telnyx, or OVH (French numbers).
- **Speech-to-text:** Deepgram, or self-hosted Whisper.
- **Voice:** ElevenLabs, Cartesia, or Azure Neural (French).
- **Model:** OpenAI, Anthropic, or Mistral (EU).

This is more work: you own latency, interruption handling and uptime. The payoff is that no third
party stores or routes the call, and it becomes defensible IP rather than a reseller markup on a
platform.

## Calendar

| Provider | Notes |
|---|---|
| **Cal.com** | Implemented (`src/providers/calendar/calcom.mjs`). Open source, self-hostable, EU hosting, simple API. Good for demos and resale. |
| **Google Calendar** | Stub. Most real clients already live here; implement with a service account or OAuth. |

## Notifications

| Channel | Provider | Notes |
|---|---|---|
| Email | **Resend** (implemented), Brevo | Recap to the business owner. |
| SMS | **Brevo transactional SMS** (implemented), Twilio, OVH | Sender max 11 chars; recipient as `33612345678` (no plus). |

## Database (the source of truth)

`src/db/store.mjs` ships an in-memory and a JSON-file store for local runs. In production use
Postgres, SQLite or Upstash, hosted where your RGPD posture requires. Nothing else in the codebase
assumes a particular database.
