-- What was sent to whom after each call, and what failed: the caller's confirmation SMS and the
-- owner's recap by email and by SMS. JSON, for example
--   {"callerSms":{"status":"failed","to":"+33612345678","reason":"brevo sms 401: ...","at":"..."},
--    "recap":{"email":{"status":"sent","at":"..."},"sms":[{"status":"sent","to":"+33600000000","at":"..."}]}}
-- The daily check reads the calls updated in the last 24 hours and emails every failure.
ALTER TABLE calls ADD COLUMN deliveries TEXT;

CREATE INDEX IF NOT EXISTS calls_by_updated ON calls (updated_at);
