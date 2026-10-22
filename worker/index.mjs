// Cloudflare Worker entry. Same business logic as api/, but Cloudflare D1 is the store
// and the EU data home. The pure core (src/core) and the providers (src/providers) are reused
// unchanged — only the server entry and the store differ from the Vercel path.
import { handleToolCall, handleCallReport } from '../src/server/handlers.mjs';
import { validateClientConfig } from '../src/core/config.mjs';
import { calcom } from '../src/providers/calendar/calcom.mjs';
import { resend } from '../src/providers/notify/resend.mjs';
import { brevoSms } from '../src/providers/notify/brevo-sms.mjs';
import { d1Store } from '../src/db/d1.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    if (env.WEBHOOK_SECRET && request.headers.get('x-vapi-secret') !== env.WEBHOOK_SECRET) {
      return json({ error: 'bad secret' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const message = body?.message ?? body;

    let deps;
    try {
      deps = buildDeps(env);
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500);
    }

    try {
      if (url.pathname === '/api/tools') return json(await handleToolCall(message, deps));
      if (url.pathname === '/api/call-report') return json(await handleCallReport(message, deps));
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e?.message ?? e) }, 500);
    }
  },
};

function buildDeps(env) {
  const raw = {
    company: env.CLIENT_COMPANY,
    metier: env.CLIENT_METIER,
    horaires: env.CLIENT_HORAIRES,
    calendar: { provider: 'calcom', id: env.CALCOM_EVENT_TYPE_ID },
    notify: { email: splitList(env.NOTIFY_EMAIL), sms: splitList(env.NOTIFY_SMS) },
  };
  const { ok, errors, config } = validateClientConfig(raw);
  if (!ok) throw new Error('invalid client config: ' + errors.join('; '));

  const calendar = calcom({ apiKey: env.CALCOM_API_KEY, eventTypeId: env.CALCOM_EVENT_TYPE_ID });
  const notify = {};
  if (env.RESEND_API_KEY) notify.email = resend({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }).sendEmail;
  if (env.BREVO_API_KEY) notify.sms = brevoSms({ apiKey: env.BREVO_API_KEY, sender: env.SMS_SENDER }).sendSms;
  const store = d1Store(env.DB);

  return { calendar, notify, store, config };
}

function splitList(s) {
  return (s || '').split(',').map((x) => x.trim()).filter(Boolean);
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
