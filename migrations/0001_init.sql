-- Cloudflare D1 schema. Your database is the source of truth for every call and appointment.
-- Applied with `npm run db:init` (wrangler d1 migrations apply). Once a migration has been applied
-- anywhere, never edit it: add the next numbered file instead.

CREATE TABLE IF NOT EXISTS calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id       TEXT    NOT NULL UNIQUE,  -- the voice platform's call id
  nom           TEXT,
  besoin        TEXT,
  urgence       TEXT,                     -- immediate | haute | normale
  telephone     TEXT,                     -- E.164, e.g. +33612345678
  email         TEXT,
  ville         TEXT,                     -- the town of the job, checked against the service area
  adresse       TEXT,                     -- the street address of the job
  complet       INTEGER NOT NULL DEFAULT 0,
  status        TEXT,                     -- rdv | a_rappeler
  urgent        INTEGER NOT NULL DEFAULT 0,
  offered       TEXT,                     -- JSON array: the slots offered as options 1 and 2
  summary       TEXT,
  note          TEXT,
  ended_at      TEXT,
  ended_reason  TEXT,
  recap_sent_at TEXT,                     -- set once the owner recap reached someone: a redelivery is not resent
  deliveries    TEXT,                     -- JSON: what was sent to whom and what failed, see below
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id     TEXT NOT NULL,
  at          TEXT NOT NULL,              -- UTC ISO start
  label       TEXT,                       -- "vendredi 23 octobre à 9 h 30", as sent to the caller
  nom         TEXT,
  besoin      TEXT,
  telephone   TEXT,
  email       TEXT,
  ville       TEXT,
  adresse     TEXT,
  urgence     TEXT,
  booking_ref TEXT,                       -- the calendar's booking uid
  created_at  TEXT NOT NULL
);

-- Every incoming call the screen saw, before anything answered it (Twilio webhook or Vapi
-- assistant-request). The limits count the allowed ones; the daily check sums up the refused ones.
CREATE TABLE IF NOT EXISTS call_attempts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           TEXT,                  -- E.164; NULL when the number is withheld
  at               TEXT NOT NULL,         -- UTC ISO
  decision         TEXT NOT NULL,         -- allowed | refused
  reason           TEXT,                  -- blocked | total | anonymous | number-hour | number-day | no-assistant
  via              TEXT NOT NULL,         -- twilio | vapi
  provider_call_id TEXT                   -- Twilio's CallSid or Vapi's call id
);

CREATE INDEX IF NOT EXISTS appointments_by_call ON appointments (call_id);
CREATE INDEX IF NOT EXISTS calls_by_created ON calls (created_at);
CREATE INDEX IF NOT EXISTS calls_by_updated ON calls (updated_at); -- the daily check reads the last 24 hours
CREATE INDEX IF NOT EXISTS call_attempts_by_number ON call_attempts (number, at);
CREATE INDEX IF NOT EXISTS call_attempts_by_at ON call_attempts (at);

-- calls.deliveries holds the caller's confirmation SMS and the owner's recap by email and by SMS,
-- each sent, failed with the provider's message, or skipped with the reason. For example
--   {"callerSms":{"status":"failed","to":"+33612345678","reason":"twilio sms 400: ...","at":"..."},
--    "recap":{"email":{"status":"sent","at":"..."},"sms":[{"status":"sent","to":"+33600000000","at":"..."}]}}
