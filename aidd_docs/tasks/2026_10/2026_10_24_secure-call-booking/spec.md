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
- The receptionist gives no firm price and no diagnosis, and never reads a technical date or an
  identifier aloud.

**Bookings**

- Only slots read from the business's calendar during the call are offered, at most two at a time,
  spoken in Paris time.
- A booking needs a name and a way to call back; the caller's own number counts.
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
  (France by default), never on a landline.

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
  answered. TBD: what flood (requests per minute) must the service withstand while still answering?
- When call screening or a provider fails, the call is still answered rather than lost.

**Data**

- Call records and appointments are stored in the European Union, in a database the operator
  controls. The voice platform keeps no recording and no transcript.
- Recording is off by default. If a business turns it on, every caller is told at the start of the
  call, as the CNIL requires.
- Records older than the business's retention period are deleted automatically. TBD: is 12 months the
  default retention period, or must each business set its own?

**Operation**

- A new business is set up by configuration alone, without changing code. A configuration that
  breaks a rule above is refused with the reason, before the first call.
- The operator receives one report a day listing every problem: a refused configuration, missing or
  refused credentials, low messaging credit, failed messages, calls cut at the time cap, numbers
  calling 5 times or more, and calls turned away. No report is sent when nothing is wrong.
- When callers start being turned away for the hourly total or the withheld-number limit, the
  operator is alerted without waiting for the daily report. TBD: within how many minutes?

## Non-goals

- Calling out: the receptionist only answers incoming calls.
- Taking payments, quoting firm prices or diagnosing a problem.
- Languages other than French.
- Health data or other regulated data, which need every hop of the voice processing to stay in the
  European Union.
- Replacing the business's calendar or customer database: the receptionist books into the calendar
  the business already uses.
- TBD: is moving or cancelling an existing booking by voice in scope? Today the receptionist records
  a call-back request instead.
- TBD: does the owner need a dashboard of calls and appointments, or are the email recaps enough?
- TBD: does one deployment serve one business only, or several businesses each with its own
  configuration and data?

## Done-when

- A caller asking for an appointment hears in the first sentence that it is an AI, is offered at most
  two real slots in French, books one, and receives one confirmation SMS on a French mobile; the
  booking appears in the business's calendar, and the owner receives the email recap.
- A caller who cannot be booked ends the call with a call-back request that reaches the owner by
  email, marked urgent when it is urgent.
- A caller reporting a gas smell hears the business's safety instructions before any slot is offered.
- A number calling for the fifth time within an hour is turned away before the receptionist answers
  and hears 112 for emergencies; a blocked number's call is refused without being answered.
- No call goes past 5 minutes, and a silent line closes after 30 seconds.
- A failed message, a refused credential, low credit, a call cut at the time cap and every turned-away
  call appear in the operator's next daily report; a wave of turned-away calls also alerts the
  operator within the agreed delay.
- A request without a valid secret or signature changes nothing and triggers no provider call.
- A record older than the retention period is no longer in the database the day after it expires.

## Stakeholders

- Decider: Tony Duong, Tony's Tech.
- Owner: Tony's Tech, maintainer of the open-source project.
- Consumers: the small businesses that take calls through it, their callers, and the resellers who
  install it for their clients.

## Context

- Product overview, costs and security model: [README](../../../../README.md).
- Every call flow in plain words: [docs/FLOWS.md](../../../../docs/FLOWS.md); where the data lives:
  [docs/DATA.md](../../../../docs/DATA.md); setting up a business:
  [docs/SETUP.md](../../../../docs/SETUP.md); the swappable providers:
  [docs/PROVIDERS.md](../../../../docs/PROVIDERS.md).
- Most of this contract is delivered as of 2026-10-24. Not delivered yet: the automatic deletion of
  old records, the immediate flood alert, and the protection against floods of unauthenticated
  requests.
