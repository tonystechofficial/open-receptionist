# Call flows

What the caller hears, what the system does, and what is stored and sent, for every situation.
Each behaviour below is pinned by a test in `test/handlers.test.mjs`. The words the agent says are
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
   written to D1, and the caller receives one SMS:
   « Plomberie Dupont : votre rendez-vous est confirmé pour le vendredi 23 octobre à 9 h 30. Pour le
   modifier, appelez le 05 56 12 34 56. » It fits one SMS and uses only the SMS alphabet.
6. The agent confirms, mentions the SMS, and closes.
7. At the end of the call the owner gets an email, « Appel de Jean Dupont : RDV vendredi 23 octobre
   à 9 h 30 », and a one-line SMS.

## 2. The caller has a preference

« Plutôt demain matin » becomes `verifier_dispos` with `jour = demain` and `moment = matin`. The
webhook understands aujourd'hui, demain, après-demain, weekday names and `AAAA-MM-JJ` dates, and
matin, après-midi and soir. If nothing fits, the agent says so and offers the nearest slots instead.

## 3. An emergency

- **Safety first.** The client config can carry safety instructions (`urgences`), read before
  anything else when the situation matches. The plumbing example covers a gas smell (leave the
  premises, touch no switch, call Urgence Sécurité Gaz on 0 800 47 33 33, free and open day and
  night, or 112 if someone feels unwell) and a major water leak (close the main valve, cut the power
  if water nears the sockets). Source for the gas number:
  [fournisseurs-electricite.com, GRDF urgence gaz](https://www.fournisseurs-electricite.com/grdf/urgence-gaz).
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

## 10. The caller hangs up early, or no tool was used

The end-of-call report still produces a recap, from what the tools captured, Vapi's call analysis
when present, and the caller ID.

## 11. The owner recap

Sent once per call: `recap_sent_at` turns a redelivered end-of-call report into a no-op. The email
lists the name, need, urgency, phone, email, the appointment or « aucun, à rappeler », and Vapi's
summary. The SMS is one line in the SMS alphabet.

## Planned, not built

- An owner dashboard served by the Worker: calls and appointments from D1, behind a token.
- Rescheduling and cancelling by voice: needs a Cal.com booking lookup by phone plus the reschedule API.
- The Google Calendar adapter (the slot exists in `src/providers/calendar/google.mjs`).
- Multi-tenant configs stored in D1, routed by assistant id or called number.
- A retention job: delete call records after a set period, as RGPD requires a defined retention.
- Naturalness tuning: an ElevenLabs French voice and Vapi's speaking-plan settings.

## First real call checklist

Some things only a real call proves. Check them in this order:

1. `GET /health` answers `{"ok":true}`.
2. Run `npm run cf:tail`. A webhook call without the credential gets 401; Vapi's calls get 200.
3. Ask for an appointment. `wrangler tail` must show a POST to `/api/vapi` with type `tool-calls`.
   If tool calls never arrive, check the tool's server URL on the assistant in the Vapi dashboard.
4. In Cal.com, the event type's booking questions must make the **phone number required and the
   email optional**, otherwise a phone-only booking is refused with a 400.
5. Book a slot, then check it in Cal.com and in D1:
   `npx wrangler d1 execute open-receptionist --remote --command "SELECT call_id, status, nom FROM calls ORDER BY created_at DESC LIMIT 5"`.
6. Hang up. The owner email and SMS arrive once; the caller SMS arrives once.
7. Check that the agent offered to call back on your own number: that proves Vapi filled in
   `{{customer.number}}`.
