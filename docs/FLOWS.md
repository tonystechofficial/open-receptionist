# Call flows

What the caller hears, what the system does, and what is stored and sent, for every situation.
Each behaviour below is pinned by a test in `test/`, the call flows in `test/handlers.test.mjs`. The words the agent says are
French, because the product answers French callers; everything else here is English.

## The three tools

| Tool | When the agent calls it | What the webhook does |
|---|---|---|
| `noter_demande` | As soon as it knows the need and the urgency, and again when it learns the name or another number | Merges the caller's details into the call record |
| `verifier_dispos` | When the caller wants an appointment | Reads Cal.com, keeps at most two slots, stores them as options 1 and 2, returns them as French labels |
| `prendre_rdv` | When the caller picks an option | Checks the name and a way to call back, books the option in Cal.com, stores the appointment, texts the caller |

All three post to one endpoint, `/api/vapi`, which also receives the end-of-call report.

## 1. The caller books an appointment

1. The agent answers: « Bonjour, vous êtes bien chez Plomberie Dupont. Je suis l'assistant vocal de
   l'entreprise, une intelligence artificielle. Que puis-je faire pour vous ? » Saying it is an AI
   is required by article 50 of the EU AI Act.
2. The caller explains. The agent rephrases the need in one sentence, sets the urgency, and calls
   `noter_demande`.
3. The agent asks the name. It offers to call back on the number the call came from, read from the
   caller ID, instead of asking for it.
4. `verifier_dispos` returns « option 1, aujourd'hui à 14 heures ; option 2, demain à 9 heures 30 ».
   The first option is the earliest slot; the second is at least three hours later, so the choice is
   real. Times are in Paris time and survive the clock change.
5. The caller picks; `prendre_rdv` books option 1 or 2 in Cal.com, with a UTC start, the phone in
   international form, the need in the notes and the urgency in the metadata. The appointment is
   written to D1, and a caller on a mobile receives one SMS:
   « Plomberie Dupont : votre rendez-vous est confirmé pour le vendredi 23 octobre à 9 h 30. Pour le
   modifier, appelez le 05 56 12 34 56. » It fits one SMS and uses only the SMS alphabet. A landline
   (`01` to `05`, `09`) cannot receive it, so none is sent.
6. The agent confirms, mentions the SMS only if it actually left, and closes.
7. At the end of the call the owner gets an email, « Appel de Jean Dupont : RDV vendredi 23 octobre
   à 9 h 30 », and a one-line SMS.

## 2. The caller has a preference

« Plutôt demain matin » becomes `verifier_dispos` with `jour = demain` and `moment = matin`. The
webhook understands aujourd'hui, demain, après-demain, weekday names and `AAAA-MM-JJ` dates, and
matin, après-midi and soir. If nothing fits, the agent says so and offers the nearest slots instead.

## 3. An emergency

- **Safety first.** The client config can carry safety instructions (`urgences`), read before
  anything else when the situation matches. The plumbing example covers a gas smell (leave the
  premises, touch no switch, call the gas emergency line from outside, or 112 if someone feels
  unwell) and a major water leak (close the main valve, cut the power if water nears the sockets).
  The instruction lives in the prompt, not in code, which is why the go-live checklist tests it.
- **The gas emergency number depends on who runs the network, not on the gas supplier.** Most of
  France is GRDF: Urgence Sécurité Gaz, 0 800 47 33 33, free, day and night
  ([source](https://www.fournisseurs-electricite.com/grdf/urgence-gaz)). Local distributors run
  their own networks with their own lines: Bordeaux and about 46 communes of Gironde are Régaz-Bordeaux,
  05 56 79 41 00, day and night (consistent secondary sources; regaz.fr was down for maintenance when
  checked on 2026-10-23). The Bordeaux example gives both; for another area, put the number of the
  client's network and keep their written validation. 112 always works.
- **No slot within four hours.** The agent says the emergency is noted as a priority and that the
  company calls back as soon as possible, and still offers the earliest slot.
- **The owner sees it first.** The recap email subject starts with `[URGENT]` and the SMS with
  `URGENT`.

## 4. Nothing is free

The agent says the company will call back, checks the number and records the request. The owner
recap says « à rappeler ».

## 5. The slot is taken between the offer and the booking

Cal.com refuses the booking. The webhook reads availability again: if the slot is gone, the agent
hears « Ce créneau vient d'être pris » followed by two new options, and options 1 and 2 now point to
them. If nothing is left, the agent offers a call-back.

## 6. Information is missing

No booking happens until there is a name and a way to call back. The caller ID counts as a way to
call back. The agent is told exactly what is missing and asks for it.

## 7. The same request twice, or a change of mind

The same slot asked again is confirmed again and booked once. A different slot after a booking is
not booked on top of it: the agent says the company will call back to change it. This prevents a
double booking when the model repeats a tool call or the caller changes their mind.

## 8. Cancelling or moving an existing appointment

The agent cannot change an existing booking yet. It records the request with `noter_demande` and says
the company will call back; the owner recap shows the request.

## 9. A provider fails

- **Calendar unreadable, or a booking refused while the slot is still free:** the agent promises a
  call-back, and the call is marked « à rappeler » with a note.
- **Webhook misconfigured:** it still answers HTTP 200 with a call-back instruction for each tool
  call. Vapi ignores tool results sent with any other status, which would leave the caller in silence.
  The daily check reports the configuration error the next morning.
- **An SMS or an email refused:** the call goes on. The refusal and the provider's message are kept in
  the call's `deliveries`, the agent does not mention an SMS that did not leave, and the daily check
  emails the failure.

## 10. The caller hangs up early, or no tool was used

The end-of-call report still produces a recap, from what the tools captured, Vapi's call analysis
when present, and the caller ID.

## 11. The owner recap

The email is required and is the record of every call; the SMS is optional, on top. The email lists
the name, need, urgency, phone, email, the appointment or « aucun, à rappeler », and Vapi's summary.
The SMS is one line in the SMS alphabet.

Sent once per call: `recap_sent_at` is set once the recap reached at least one recipient, and turns a
redelivered end-of-call report into a no-op. A recap that reached nobody leaves it unset, so a
redelivered report tries again. Each channel's result is kept in `deliveries`.

## 12. The daily check

Every morning a cron trigger runs the check, and `GET /api/check` (with the webhook secret) runs it on
demand. It reports a configuration the Worker would refuse, a missing provider key, SMS credentials
the provider refuses (Brevo's IP blocking, on by default for new accounts, refuses a Worker, which
has no fixed IP), low SMS credit (a Twilio balance under 5, or fewer than 20 Brevo credits), and
every SMS or recap that failed in the last 24 hours, as well as every ended call that never got a
recap, every call cut at the time cap, any number that called 5 times or more, and the calls the
screen refused, per number and reason. When it finds something, it emails `ALERT_EMAIL`, or the first
`NOTIFY_EMAIL`, with one line per problem. Then, whatever it found, it deletes the records older than
`RETENTION_DAYS` (12 months by default).

## 13. A long, silent or abusive call

Every minute is billed, so three limits end a call that should end:

- **The time cap.** Vapi cuts the call at `maxDurationSeconds`, 300 by default (the configuration
  check accepts 60 to 1,800). The agent knows the cap from its prompt.
- **Silence.** Vapi hangs up after `silenceTimeoutSeconds` without speech, 30 by default (10 to 120).
- **The agent hangs up.** Once the caller has no more questions, the agent calls Vapi's `endCall`
  tool, and `endCallMessage` says goodbye. It also hangs up on an abusive or prank call, or on an
  off-topic conversation that goes on after its answer, but never during an emergency.

The end-of-call report records Vapi's reason (`exceeded-max-duration`, `silence-timed-out`,
`assistant-ended-call`, `customer-ended-call`) in `ended_reason`, which the daily check reads.

## 14. Screening a call before anything answers

The Worker counts the calls it let through and turns a caller away when:

| Reason | Rule (default, set in `[vars]`) | What the caller gets |
|---|---|---|
| `blocked` | the number is in `BLOCKED_NUMBERS` | method 1: rejected, never answered; method 2: one sentence |
| `number-hour`, `number-day` | 4 calls this hour, or 8 today, already let through for this number | « Vos appels précédents ont bien été transmis… », and 112 for an emergency |
| `anonymous` | 5 withheld numbers already let through this hour | asked to call back without hiding the number |
| `total` | 30 calls already let through this hour, all callers together | asked to call back later |

Every refusal names 112 for an emergency. Method 1 runs at Twilio, before Vapi (`/api/twilio/voice`,
signed requests only); method 2 runs when Vapi asks which assistant answers (`assistant-request`).
Use one, not both. Each screened call becomes a row of `call_attempts`; only allowed calls count
toward the limits, so a refused caller is let through again once the hour or the day has passed. If
the screen breaks, the call is let through rather than lost.

A wave cannot be stopped number by number, so the first call turned away for the hourly total or for
withheld numbers emails the operator at once, once per hour per kind; a single number calling too
often waits for the daily report. A failed alert never blocks the screening.

## 15. Questions about the business, prices and the service area

The business writes what callers may hear in `infos` (services, what it does not do, towns served,
call-out fee, hourly rate, flat prices, whether the quote is free, payment methods, common questions).
How it enters the call:

1. **The town, early.** With a service area set, the agent asks the town of the job right after
   understanding the need, then the address, and notes them. The webhook checks the town: outside
   the area, the agent says the business does not work there and offers no slot. The webhook also
   refuses to read slots or book before the town is known, or for a town outside the area, so the
   rule holds even if the model forgets it.
2. **Answers on demand.** « C'est combien le déplacement ? », « Vous faites les chauffe-eau ? »,
   « Vous prenez la carte ? »: the agent answers in one or two sentences, word for word from `infos`.
   It never recites the list. What is not written, it says the business will tell.
3. **The price, once, before booking.** After offering the two slots and before booking, the agent
   states the call-out fee and whether the quote is free, so the caller books knowing the price.
4. **Never a quote.** Asked the price of a specific job, the agent gives the flat price if `infos`
   lists one, otherwise says the exact price comes in a quote before the work. No diagnosis.
5. **In writing.** With `tarifsUrl` set, the confirmation SMS ends with the link to the rates page.
   The SMS may then take two segments.

The town and the address go to the calendar booking's notes, to the owner's recap, and to the call
record. The Worker enforces the area from `CLIENT_ZONE`; the agent learns it from `infos.zone` in
`config/client.json`: keep both lists the same.

## Planned, not built

- An owner dashboard served by the Worker: calls and appointments from D1, behind a token.
- Rescheduling and cancelling by voice: needs a Cal.com booking lookup by phone plus the reschedule API.
- The Google Calendar adapter (the slot exists in `src/providers/calendar/google.mjs`).
- Multi-tenant configs stored in D1, routed by assistant id or called number.
- A retention job: delete call records after a set period, as RGPD requires a defined retention.
- Naturalness tuning: an ElevenLabs French voice and Vapi's speaking-plan settings.

## First real call checklist

Some things only a real call proves. Check them in this order:

1. `GET /health` answers `{"ok":true}`, and `GET /api/check` with the webhook secret answers
   `{"ok":true,"problems":[]}`.
2. Run `npm run cf:tail`. A webhook call without the credential gets 401; Vapi's calls get 200.
3. Ask for an appointment. `wrangler tail` must show a POST to `/api/vapi` with type `tool-calls`.
   If tool calls never arrive, check the tool's server URL on the assistant in the Vapi dashboard.
4. In Cal.com, the event type's booking questions must make the **phone number required and the
   email optional**, otherwise a phone-only booking is refused with a 400.
5. Book a slot, then check it in Cal.com and in D1:
   `npx wrangler d1 execute open-receptionist --remote --command "SELECT call_id, status, nom, deliveries FROM calls ORDER BY created_at DESC LIMIT 5"`.
6. Hang up. The owner email and SMS arrive once; the caller SMS arrives once. In D1, `deliveries`
   shows each of them as `sent`.
7. Check that the agent offered to call back on your own number: that proves Vapi filled in
   `{{customer.number}}`.
