// Assemble the dependencies (providers + store + validated config) for the Node/Vercel entry.
// For a single-client deployment this reads config/client.json, or the environment as a fallback.
// Multi-tenant: route by the Vapi assistant id or the called number to the right client config,
// then build deps per client.
import { readFile } from 'node:fs/promises';
import { validateClientConfig } from '../core/config.mjs';
import { blockedNumbers, screeningLimits } from '../core/screening.mjs';
import { calcom } from '../providers/calendar/calcom.mjs';
import { google } from '../providers/calendar/google.mjs';
import { resend } from '../providers/notify/resend.mjs';
import { smsProvider } from '../providers/notify/sms.mjs';
import { jsonFileStore, memoryStore } from '../db/store.mjs';

let cached;

export async function buildDeps() {
  if (cached) return cached;
  const env = process.env;

  const sms = smsProvider(env);
  const providers = { email: Boolean(env.RESEND_API_KEY), sms: sms.adapter !== null };
  const { ok, errors, warnings, config } = validateClientConfig((await readClientConfig()) ?? envConfig(env), { providers });
  if (!ok) throw new Error(`invalid client config: ${errors.join('; ')}`);
  for (const warning of [...sms.warnings, ...warnings]) console.warn('[open-receptionist]', warning);

  const calendar = config.calendar?.provider === 'google'
    ? google()
    : calcom({
      apiKey: env.CALCOM_API_KEY,
      eventTypeId: env.CALCOM_EVENT_TYPE_ID ?? config.calendar?.id,
      slotsApiVersion: env.CALCOM_SLOTS_API_VERSION || undefined,
      bookingsApiVersion: env.CALCOM_BOOKINGS_API_VERSION || undefined,
    });

  const notify = {};
  if (env.RESEND_API_KEY) notify.email = resend({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }).sendEmail;
  if (sms.adapter) notify.sms = sms.adapter.sendSms; // the handlers pass the validated sender with each SMS

  const store = env.DATA_FILE ? jsonFileStore(env.DATA_FILE) : memoryStore();

  // Call screening, method 2 (assistant-request); the Twilio entry of method 1 lives in the Worker only.
  const screening = { assistantId: env.VAPI_ASSISTANT_ID || undefined, blocked: blockedNumbers(env.BLOCKED_NUMBERS), limits: screeningLimits(env) };

  cached = { calendar, notify, store, config, screening };
  return cached;
}

async function readClientConfig() {
  try {
    return JSON.parse(await readFile(new URL('../../config/client.json', import.meta.url), 'utf8'));
  } catch {
    return null;
  }
}

function envConfig(env) {
  const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    company: env.CLIENT_COMPANY,
    metier: env.CLIENT_METIER,
    horaires: env.CLIENT_HORAIRES,
    telephone: env.CLIENT_TELEPHONE || undefined,
    timeZone: env.TIME_ZONE || undefined,
    smsSender: env.SMS_SENDER || undefined,
    smsCountries: list(env.SMS_COUNTRIES),
    infos: { zone: list(env.CLIENT_ZONE), tarifsUrl: env.CLIENT_TARIFS_URL || undefined },
    confirmation: { sms: env.CONFIRM_CALLER_SMS !== 'false' },
    calendar: { provider: 'calcom', id: env.CALCOM_EVENT_TYPE_ID },
    notify: { email: list(env.NOTIFY_EMAIL), sms: list(env.NOTIFY_SMS) },
  };
}
