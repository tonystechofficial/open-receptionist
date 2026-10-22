// Assemble the dependencies (providers + store + validated config) from the environment.
// For a single-client demo this reads config/client.json (or env). Multi-tenant: route by the
// Vapi assistantId or the called number to the right client config, then build deps per client.
import { readFile } from 'node:fs/promises';
import { validateClientConfig } from '../core/config.mjs';
import { calcom } from '../providers/calendar/calcom.mjs';
import { google } from '../providers/calendar/google.mjs';
import { resend } from '../providers/notify/resend.mjs';
import { brevoSms } from '../providers/notify/brevo-sms.mjs';
import { jsonFileStore, memoryStore } from '../db/store.mjs';

let cached;

export async function buildDeps() {
  if (cached) return cached;

  const raw = (await readClientConfig()) ?? envConfig();
  const { ok, errors, config } = validateClientConfig(raw);
  if (!ok) throw new Error('invalid client config: ' + errors.join('; '));

  const calendar = config.calendar?.provider === 'google'
    ? google()
    : calcom({ apiKey: process.env.CALCOM_API_KEY, eventTypeId: process.env.CALCOM_EVENT_TYPE_ID ?? config.calendar?.id });

  const notify = {};
  if (process.env.RESEND_API_KEY) notify.email = resend({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM }).sendEmail;
  if (process.env.BREVO_API_KEY) notify.sms = brevoSms({ apiKey: process.env.BREVO_API_KEY, sender: process.env.SMS_SENDER }).sendSms;

  const store = process.env.DATA_FILE ? jsonFileStore(process.env.DATA_FILE) : memoryStore();

  cached = { calendar, notify, store, config };
  return cached;
}

async function readClientConfig() {
  try { return JSON.parse(await readFile(new URL('../../config/client.json', import.meta.url), 'utf8')); } catch { return null; }
}

function envConfig() {
  return {
    company: process.env.CLIENT_COMPANY,
    metier: process.env.CLIENT_METIER,
    horaires: process.env.CLIENT_HORAIRES,
    calendar: { provider: 'calcom', id: process.env.CALCOM_EVENT_TYPE_ID },
    notify: {
      email: (process.env.NOTIFY_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean),
      sms: (process.env.NOTIFY_SMS || '').split(',').map((s) => s.trim()).filter(Boolean),
    },
  };
}
