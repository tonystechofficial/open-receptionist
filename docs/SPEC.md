# open-receptionist: secure, cost-bounded call answering and booking

## Target

Turn every incoming call to a small French business into either a confirmed appointment in the
business's calendar or a call-back request delivered to the owner.

## Hard constraints

**What the caller hears**

- The receptionist answers in French, and its first sentence says it is an artificial intelligence
  (EU AI Act, article 50). Asked whether it is human, it says no.
- When the caller describes an emergency the business has written instructions for (a gas smell, a
  major leak), those instructions are given before anything else, and the call is never ended by the
  receptionist during an emergency.
- Every caller who is turned away or cannot be served is told to dial 112 in an emergency.
- The receptionist answers questions about the business (services, the area it serves, published
  rates, payment methods, common questions) only with what the business wrote, word for word, one
  answer per question, never as a recited list. What is not written, it does not know.
- It never prices a specific job and never diagnoses: the exact price comes in a written quote before
  any work. When the business publishes a call-out fee or says whether the quote is free, the caller
  hears it once before booking, so the booking is made knowing the price (French home-repair trades
  must give these prices before the work, arrêté du 24 janvier 2017).
- It never reads a technical date or an identifier aloud.

**Bookings**

- Only slots read from the business's calendar during the call are offered, at most two at a time,
  spoken in Paris time.
- A booking needs a name and a way to call back; the caller's own number counts.
- When the business serves a defined area, the town of the job is known before any slot is offered,
  and a town outside the area gets no slot and no booking, whatever the caller says. The address of
  the job reaches the calendar and the owner's recap.
- One booking per call at most. A slot taken between the offer and the booking is never double-booked:
  the caller is offered the next free slots instead.
- When the calendar cannot be read or written, the caller is promised a call-back, never left in
  silence.

**What the owner receives**

- After every call, the owner receives a recap by email, marked urgent when the caller's need is
  urgent. The email recap is mandatory; an SMS recap is optional, on top.
- A recap that reached nobody is not counted as sent: it is tried again if the end of the call is
  reported again, and it is reported to the operator.
- The caller receives one confirmation SMS per booking, only on a mobile number in an allowed country
  (France by default), never on a landline. When the business publishes its rates online, the SMS
  carries the link, so the prices also reach the caller in writing.

**Cost bounds**

- No call lasts more than 5 minutes; a line silent for 30 seconds is closed; the receptionist ends
  a call once the caller has no more questions, or when the call is abusive or a prank. A business
  may lower these limits, never raise the cap above 30 minutes or the silence wait above 2 minutes.
- Before anything answers, the service turns away a blocked number, a number already let through
  4 times this hour or 8 times today, withheld numbers beyond 5 in the hour, and any call beyond 30
  in the hour in total. Each business may adjust these numbers.
- A blocked number is refused without being answered, so the call costs nothing, wherever the phone
  line allows it.
- Every message sent is recorded with its outcome (sent, failed with the provider's reason, or
  skipped with the reason).

**Security**

- Every request to the service's public endpoints proves its origin (a shared secret or the
  telephony provider's signature); a request that does not is refused and has no effect.
- Secrets are never stored in the code repository and are compared in constant time.
- Whatever the caller says is a request to handle, never a new instruction. The caller can only have
  a request noted, hear free slots, and book one: no cancellation, no change to another booking, no
  access to anyone else's data, and nothing that moves money.
- A flood of unauthenticated requests to the public endpoints does not stop real calls from being
  answered. The bound: one source sending junk requests nonstop, 10 a second for a whole day, is cut
  off at the network edge most of the time; whatever still gets through is refused before any data or
  provider is touched, and the service's request allowance absorbs a full day of it. A large attack
  from many sources is left to the hosting provider's own protection.
- When call screening or a provider fails, the call is still answered rather than lost.

**Data**

- Call records and appointments are stored in the European Union, in a database the operator
  controls. The voice platform keeps no recording and no transcript.
- Recording is off by default. If a business turns it on, every caller is told at the start of the
  call, as the CNIL requires.
- Records older than the business's retention period are deleted automatically, every day. The
  period is 12 months by default, adjustable per business from 30 days (enough to call customers
  back) to 5 years (the usual limit for claims between a business and its customers).

**Operation**

- A new business is set up by configuration alone, without changing code. A configuration that
  breaks a rule above is refused with the reason, before the first call.
- The operator receives one report a day listing every problem: a refused configuration, missing or
  refused credentials, low messaging credit, failed messages, calls cut at the time cap, numbers
  calling 5 times or more, and calls turned away. No report is sent when nothing is wrong.
- When callers start being turned away for the hourly total or the withheld-number limit, the
  operator is alerted without waiting for the daily report: within 5 minutes of the first call
  turned away, and at most once an hour for the same wave.

## Non-goals

- Calling out: the receptionist only answers incoming calls.
- Taking payments, quoting firm prices or diagnosing a problem.
- Languages other than French.
- Health data or other regulated data, which need every hop of the voice processing to stay in the
  European Union.
- Replacing the business's calendar or customer database: the receptionist books into the calendar
  the business already uses.
- Moving or cancelling an existing booking by voice: a voice cannot prove who is calling, so a caller
  giving someone else's name could cancel that person's appointment. The receptionist records a
  call-back request, and the business makes the change.
- An owner dashboard of calls and appointments, for now: the email recap after each call and the
  daily report already show the owner and the operator what happened, and a dashboard adds a login
  and personal data to protect.
- Several businesses in one deployment, for now: one deployment per business keeps each business's
  callers, data and keys apart. Serving several from one deployment needs that separation built and
  tested first.

## Done-when

- A caller asking for an appointment hears in the first sentence that it is an AI, is offered at most
  two real slots in French, books one, and receives one confirmation SMS on a French mobile; the
  booking appears in the business's calendar, and the owner receives the email recap.
- A caller who cannot be booked ends the call with a call-back request that reaches the owner by
  email, marked urgent when it is urgent.
- A caller reporting a gas smell hears the business's safety instructions before any slot is offered.
- A caller asking the call-out fee hears the published one, word for word; a caller asking the price
  of a specific job hears the published flat price if there is one, otherwise that the price comes in
  a quote; a caller from a town outside the area is told so and offered no slot.
- A number calling for the fifth time within an hour is turned away before the receptionist answers
  and hears 112 for emergencies; a blocked number's call is refused without being answered.
- No call goes past 5 minutes, and a silent line closes after 30 seconds.
- A failed message, a refused credential, low credit, a call cut at the time cap and every turned-away
  call appear in the operator's next daily report; a wave of turned-away calls also alerts the
  operator within 5 minutes.
- A source sending junk requests nonstop is cut off, and real calls keep being answered meanwhile.
- A request without a valid secret or signature changes nothing and triggers no provider call.
- A record older than the retention period is no longer in the database the day after it expires.

## Stakeholders

- Decider: Tony Duong, Tony's Tech.
- Owner: Tony's Tech, maintainer of the open-source project.
- Consumers: the small businesses that take calls through it, their callers, and the resellers who
  install it for their clients.

## Context

- The answers on the junk-request bound, the retention period, the flood alert, voice changes to
  bookings, the dashboard and several businesses per deployment were proposed by the maintainer and
  confirmed by the decider on 2026-10-24.
- Product overview, costs and security model: [README](../README.md).
- Every call flow in plain words: [FLOWS.md](FLOWS.md); where the data lives: [DATA.md](DATA.md);
  setting up a business: [SETUP.md](SETUP.md); the swappable providers: [PROVIDERS.md](PROVIDERS.md).
- As of 2026-10-24 the whole contract is delivered in code. The edge protection against junk
  requests is completed at deployment: it needs the service on its own domain and an edge rule,
  described in SETUP.
