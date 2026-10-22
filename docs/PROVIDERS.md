# Swappable providers

Every external piece sits behind a small interface in `src/providers/`, so you can change vendor
without touching the flows. This file lists the options and what each adapter was checked against.

## Voice platform (the realtime loop)

The realtime loop is telephony plus speech-to-text plus the model plus the voice, with interruptions
and low latency. Two ways to get it.

### Drop-in platforms (fastest)

| Platform | Notes |
|---|---|
| **Vapi** | Implemented (`src/providers/voice/vapi.mjs`). Tool calls and end-of-call reports go to one webhook, `/api/vapi`, authenticated by a Vapi Custom Credential that sends `X-Vapi-Secret`. Checked against Vapi's docs on 2026-10-22. |
| **Retell AI** | Stub with the same readers. Same shape: agent, tools, post-call webhook. |
| **Bland AI** | Phone-first, enterprise leaning. |
| **Synthflow** | More no-code, built-in calendar and number. |
| **Telnyx Voice AI** | Telephony vendor with a voice-agent layer and EU numbers. |

All of them follow the same pattern: a number, function tools during the call, a webhook at the end.
The caller's details travel through our own tools, so switching platform means mapping a few readers
(`getToolCalls`, `getCallId`, `getCallerNumber`, `getAnalysis`, `isEndOfCall`), not rewriting flows.

### Self-hosted, EU-sovereign (full data control)

Assemble the loop yourself when you must own every hop, for regulated data or strict RGPD:

- **Framework:** LiveKit Agents or Pipecat, both open source and self-hostable.
- **Telephony and number:** Twilio, Telnyx, or OVH for French numbers.
- **Speech-to-text:** Deepgram, or self-hosted Whisper.
- **Voice:** ElevenLabs, Cartesia, or Azure Neural, in French.
- **Model:** OpenAI, Anthropic, or Mistral (EU).

This is more work: you own latency, interruption handling and uptime. The payoff is that no third
party stores or routes the call.

## Calendar

| Provider | Notes |
|---|---|
| **Cal.com** | Implemented (`src/providers/calendar/calcom.mjs`). Open source, self-hostable, EU hosting. |
| **Google Calendar** | Stub. Most real clients already live here; implement with a service account or OAuth. |

Cal.com API v2 pins a version per endpoint, and a wrong or missing `cal-api-version` header silently
falls back to an older contract. Checked on 2026-10-22:

- **Slots:** `GET /v2/slots` with `cal-api-version: 2024-09-04`, `eventTypeId`, `start`, `end` and
  `timeZone` ([docs](https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type)).
- **Bookings:** `POST /v2/bookings` with `cal-api-version: 2026-02-25`, a UTC `start`, and an attendee
  whose `email` is optional and `phoneNumber` is in international form
  ([docs](https://cal.com/docs/api-reference/v2/bookings/create-a-booking)).

Both versions can be overridden with `CALCOM_SLOTS_API_VERSION` and `CALCOM_BOOKINGS_API_VERSION`.
For phone-only bookings, the event type's booking questions must make the phone required and the
email optional.

## Notifications

| Channel | Provider | Notes |
|---|---|---|
| Email | **Resend** (implemented) | Owner recap. Works from any IP, which matters for a Worker. |
| SMS | **Brevo transactional SMS** (implemented) | Caller confirmation and owner recap. Sender 3 to 11 letters or digits; texts are kept in the SMS alphabet so one message holds 160 characters. |

## Database (the source of truth)

`src/db/d1.mjs` is the production store on Cloudflare D1. `src/db/store.mjs` ships an in-memory and
a JSON-file store for local runs and tests. Any other database only needs the same five methods:
`getCall`, `upsertCall`, `saveAppointment`, `findAppointmentByCallId`, `all`.
