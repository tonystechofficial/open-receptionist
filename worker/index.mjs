// Cloudflare Worker entry: the deployed webhook. Cloudflare D1 is the store and the EU data home.
// The pure core (src/core), the flows (src/server/handlers.mjs) and the providers are shared
// with the Node/Vercel entry in api/; only the server entry and the store differ.
import { handleVapiMessage } from '../src/server/handlers.mjs';
import { fallbackResponse } from '../src/server/fallback.mjs';
import { validateClientConfig } from '../src/core/config.mjs';
import { calcom } from '../src/providers/calendar/calcom.mjs';
import { resend } from '../src/providers/notify/resend.mjs';
import { brevoSms } from '../src/providers/notify/brevo-sms.mjs';
import { d1Store } from '../src/db/d1.mjs';

// One endpoint for everything Vapi posts. The two older paths stay as aliases.
const WEBHOOK_PATHS = new Set(['/api/vapi', '/api/tools', '/api/call-report']);

export function createWorker({ makeStore = (env) => d1Store(env.DB) } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
      if (!WEBHOOK_PATHS.has(url.pathname)) return json({ error: 'not found' }, 404);
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      if (env.WEBHOOK_SECRET && request.headers.get('x-vapi-secret') !== env.WEBHOOK_SECRET) {
        return json({ error: 'bad secret' }, 401);
      }

      const body = await request.json().catch(() => ({}));
      const message = body?.message ?? body;
      try {
        return json(await handleVapiMessage(message, buildDeps(env, makeStore)));
      } catch (error) {
        console.error('[open-receptionist]', error);
        return json(fallbackResponse(message)); // still a 200: Vapi ignores tool results on other codes
      }
    },
  };
}

export default createWorker();

export function buildDeps(env, makeStore = (e) => d1Store(e.DB)) {
  const { ok, errors, config } = validateClientConfig({
    company: env.CLIENT_COMPANY,
    metier: env.CLIENT_METIER,
    horaires: env.CLIENT_HORAIRES,
    telephone: env.CLIENT_TELEPHONE || undefined,
    timeZone: env.TIME_ZONE || undefined,
    smsSender: env.SMS_SENDER || undefined,
    confirmation: { sms: env.CONFIRM_CALLER_SMS !== 'false' },
    calendar: { provider: 'calcom', id: env.CALCOM_EVENT_TYPE_ID },
    notify: { email: splitList(env.NOTIFY_EMAIL), sms: splitList(env.NOTIFY_SMS) },
  });
  if (!ok) throw new Error(`invalid client config: ${errors.join('; ')}`);

  const calendar = calcom({
    apiKey: env.CALCOM_API_KEY,
    eventTypeId: env.CALCOM_EVENT_TYPE_ID,
    slotsApiVersion: env.CALCOM_SLOTS_API_VERSION || undefined,
    bookingsApiVersion: env.CALCOM_BOOKINGS_API_VERSION || undefined,
  });
  const notify = {};
  if (env.RESEND_API_KEY) notify.email = resend({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }).sendEmail;
  if (env.BREVO_API_KEY) notify.sms = brevoSms({ apiKey: env.BREVO_API_KEY, sender: env.SMS_SENDER || undefined }).sendSms;

  return { calendar, notify, store: makeStore(env), config };
}

function splitList(s) {
  return (s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
