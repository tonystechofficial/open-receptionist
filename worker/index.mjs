// Cloudflare Worker entry: the deployed webhook. Cloudflare D1 is the store and the EU data home.
// The pure core (src/core), the flows (src/server/handlers.mjs) and the providers are shared
// with the Node/Vercel entry in api/; only the server entry and the store differ.
import { handleVapiMessage } from '../src/server/handlers.mjs';
import { fallbackResponse } from '../src/server/fallback.mjs';
import { validateClientConfig } from '../src/core/config.mjs';
import { deliveryProblems, callProblems, screeningProblems, alertEmail, creditProblem } from '../src/core/alerts.mjs';
import { blockedNumbers, screeningLimits } from '../src/core/screening.mjs';
import { normalizePhone } from '../src/core/phone.mjs';
import { screenIncoming } from '../src/server/screening.mjs';
import { safeEqual } from '../src/server/secrets.mjs';
import { calcom } from '../src/providers/calendar/calcom.mjs';
import { resend } from '../src/providers/notify/resend.mjs';
import { smsProvider } from '../src/providers/notify/sms.mjs';
import { verifyTwilioSignature, twimlForward, twimlReject, twimlSayAndHangUp } from '../src/providers/telephony/twilio-voice.mjs';
import { d1Store } from '../src/db/d1.mjs';

// One endpoint for everything Vapi posts. The two older paths stay as aliases.
const WEBHOOK_PATHS = new Set(['/api/vapi', '/api/tools', '/api/call-report']);
const DAY_MS = 86_400_000;

export function createWorker({ makeStore = (env) => d1Store(env.DB) } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
      // The daily check on demand, to verify a setup: same secret as the webhook, nothing is emailed.
      if (url.pathname === '/api/check') {
        if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
        if (!safeEqual(request.headers.get('x-vapi-secret'), env.WEBHOOK_SECRET)) {
          return json({ error: 'bad secret' }, 401);
        }
        return json(await runCheck(env, makeStore));
      }
      // Call screening, method 1: Twilio posts each incoming call here before Vapi sees it.
      if (url.pathname === '/api/twilio/voice') {
        if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
        return twilioVoice(request, env, makeStore);
      }
      if (!WEBHOOK_PATHS.has(url.pathname)) return json({ error: 'not found' }, 404);
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      if (env.WEBHOOK_SECRET && !safeEqual(request.headers.get('x-vapi-secret'), env.WEBHOOK_SECRET)) {
        return json({ error: 'bad secret' }, 401);
      }

      const body = await request.json().catch(() => ({}));
      const message = body?.message ?? body;
      if (message && !message.call && body?.call) message.call = body.call; // where Vapi's example puts it
      try {
        return json(await handleVapiMessage(message, buildDeps(env, makeStore)));
      } catch (error) {
        console.error('[open-receptionist]', error);
        // A broken screen must not lose a real call: route it to the assistant anyway.
        if (message?.type === 'assistant-request' && env.VAPI_ASSISTANT_ID) return json({ assistantId: env.VAPI_ASSISTANT_ID });
        return json(fallbackResponse(message)); // still a 200: Vapi ignores tool results on other codes
      }
    },

    // Cron trigger ([triggers] in wrangler.toml): the daily check, emailed only when something is wrong.
    async scheduled(controller, env, ctx) {
      ctx.waitUntil(dailyCheck(env, makeStore));
    },
  };
}

export default createWorker();

export function buildDeps(env, makeStore = (e) => d1Store(e.DB)) {
  const sms = smsProvider(env);
  const providers = { email: Boolean(env.RESEND_API_KEY), sms: sms.adapter !== null };
  const { ok, errors, warnings, config } = validateClientConfig({
    company: env.CLIENT_COMPANY,
    metier: env.CLIENT_METIER,
    horaires: env.CLIENT_HORAIRES,
    telephone: env.CLIENT_TELEPHONE || undefined,
    timeZone: env.TIME_ZONE || undefined,
    smsSender: env.SMS_SENDER || undefined,
    smsCountries: splitList(env.SMS_COUNTRIES),
    confirmation: { sms: env.CONFIRM_CALLER_SMS !== 'false' },
    calendar: { provider: 'calcom', id: env.CALCOM_EVENT_TYPE_ID },
    notify: { email: splitList(env.NOTIFY_EMAIL), sms: splitList(env.NOTIFY_SMS) },
  }, { providers });
  if (!ok) throw new Error(`invalid client config: ${errors.join('; ')}`);

  const calendar = calcom({
    apiKey: env.CALCOM_API_KEY,
    eventTypeId: env.CALCOM_EVENT_TYPE_ID,
    slotsApiVersion: env.CALCOM_SLOTS_API_VERSION || undefined,
    bookingsApiVersion: env.CALCOM_BOOKINGS_API_VERSION || undefined,
  });
  const notify = {};
  if (env.RESEND_API_KEY) notify.email = resend({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }).sendEmail;
  if (sms.adapter) notify.sms = sms.adapter.sendSms; // the handlers pass the validated sender with each SMS

  const screening = {
    assistantId: env.VAPI_ASSISTANT_ID || undefined,
    blocked: blockedNumbers(env.BLOCKED_NUMBERS),
    limits: screeningLimits(env),
  };
  return { calendar, notify, store: makeStore(env), config, warnings, screening };
}

/**
 * Method 1 of call screening. Only a request signed with the account's Auth Token is read; a refused
 * call is rejected (blocked number) or told why in one sentence, and never reaches Vapi.
 */
async function twilioVoice(request, env, makeStore) {
  const params = Object.fromEntries(new URLSearchParams(await request.text()));
  const signed = await verifyTwilioSignature({
    url: request.url, params, signature: request.headers.get('x-twilio-signature'), authToken: env.TWILIO_AUTH_TOKEN,
  });
  if (!signed) return new Response('forbidden', { status: 403 });

  const forward = twimlForward(env.VAPI_TWILIO_INBOUND_URL || undefined);
  try {
    const call = { number: normalizePhone(params.From), via: 'twilio', providerCallId: params.CallSid };
    const verdict = await screenIncoming(call, buildDeps(env, makeStore));
    if (verdict.allow) return twiml(forward);
    return twiml(verdict.reason === 'blocked' ? twimlReject() : twimlSayAndHangUp(verdict.message));
  } catch (error) {
    console.error('[open-receptionist] screening failed, call let through', error);
    return twiml(forward); // a broken screen must not lose a real call
  }
}

function twiml(body) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/xml' } });
}

/**
 * Everything that would keep a call from reaching the owner: a configuration the webhook refuses,
 * SMS credentials the provider refuses (Brevo's IP lock, on by default for new accounts, blocks a
 * Worker), SMS credit running out, and every delivery that failed in the last 24 hours.
 */
export async function runCheck(env, makeStore = (e) => d1Store(e.DB), now = new Date()) {
  const problems = [];
  let deps = null;
  try {
    deps = buildDeps(env, makeStore);
    problems.push(...deps.warnings.map((w) => `Configuration : ${w}`));
  } catch (error) {
    problems.push(`Configuration refusée, chaque appel reçoit une promesse de rappel : ${error.message}`);
  }

  const sms = smsProvider(env);
  problems.push(...sms.warnings.map((w) => `Configuration : ${w}`));
  if (sms.adapter) {
    try {
      const problem = creditProblem(sms.name, await sms.adapter.check());
      if (problem) problems.push(problem);
    } catch (error) {
      const hint = sms.name === 'brevo' && /IP address/i.test(error.message)
        ? ' Brevo bloque les adresses IP inconnues : dans Brevo, Sécurité > IP autorisées, désactiver le blocage.'
        : '';
      problems.push(`Le fournisseur SMS (${sms.name}) refuse les identifiants : ${clip(error.message)}.${hint}`);
    }
  }

  try {
    const store = deps?.store ?? makeStore(env);
    const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
    const recent = await store.callsUpdatedSince(dayAgo);
    problems.push(...deliveryProblems(recent), ...callProblems(recent), ...screeningProblems(await store.attemptsSince(dayAgo)));
  } catch (error) {
    problems.push(`Base de données illisible : ${clip(error.message)}`);
  }
  return { ok: problems.length === 0, problems };
}

/** Run the check and email the problems to ALERT_EMAIL, or else to the first NOTIFY_EMAIL. */
async function dailyCheck(env, makeStore) {
  const report = await runCheck(env, makeStore);
  if (report.ok) return report;
  console.error('[open-receptionist] daily check:', report.problems.join(' | '));
  const to = env.ALERT_EMAIL || splitList(env.NOTIFY_EMAIL)[0];
  if (!env.RESEND_API_KEY || !to) return report;
  try {
    const mail = alertEmail({ company: env.CLIENT_COMPANY || 'open-receptionist', problems: report.problems });
    await resend({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM }).sendEmail({ to, ...mail });
  } catch (error) {
    console.error('[open-receptionist] alert email failed', error);
  }
  return report;
}

function clip(s) {
  return String(s).slice(0, 300);
}

function splitList(s) {
  return (s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
