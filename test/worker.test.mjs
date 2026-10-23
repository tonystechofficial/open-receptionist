// The deployed Worker: routing, webhook authentication, and the 200 fallback Vapi needs.
// The store is in memory and Cal.com is a fake fetch, so nothing leaves the machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../worker/index.mjs';
import { memoryStore } from '../src/db/store.mjs';

const ENV = {
  WEBHOOK_SECRET: 's3cret',
  CLIENT_COMPANY: 'Plomberie Dupont',
  CLIENT_METIER: 'plomberie',
  CALCOM_API_KEY: 'k',
  CALCOM_EVENT_TYPE_ID: '7',
  NOTIFY_EMAIL: 'patron@dupont.fr',
};
const worker = createWorker({ makeStore: () => memoryStore() });
const toolCall = {
  message: {
    type: 'tool-calls',
    call: { id: 'call_1', customer: { number: '+33612345678' } },
    toolCallList: [{ id: 'tc_1', type: 'function', function: { name: 'verifier_dispos', arguments: {} } }],
  },
};
const post = (path, body, headers = { 'x-vapi-secret': 's3cret' }) =>
  new Request(`https://w.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function withFakeCalCom(fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: 'success',
    data: { '2030-01-07': [{ start: '2030-01-07T09:00:00.000+01:00' }, { start: '2030-01-07T15:00:00.000+01:00' }] },
  }), { status: 200 });
  try { return await fn(); } finally { globalThis.fetch = previous; }
}

test('health answers without a secret', async () => {
  const res = await worker.fetch(new Request('https://w.example/health'), ENV);
  assert.equal(res.status, 200);
});

test('a webhook call without the secret is refused', async () => {
  const res = await worker.fetch(post('/api/vapi', toolCall, {}), ENV);
  assert.equal(res.status, 401);
});

test('an unknown path is a 404', async () => {
  const res = await worker.fetch(post('/api/other', toolCall), ENV);
  assert.equal(res.status, 404);
});

test('tool calls on /api/vapi come back as Vapi results', async () => {
  const res = await withFakeCalCom(() => worker.fetch(post('/api/vapi', toolCall), ENV));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results[0].toolCallId, 'tc_1');
  assert.equal(body.results[0].name, 'verifier_dispos');
  assert.match(body.results[0].result, /option 1, /);
});

test('the earlier /api/tools path still works', async () => {
  const res = await withFakeCalCom(() => worker.fetch(post('/api/tools', toolCall), ENV));
  assert.equal((await res.json()).results[0].toolCallId, 'tc_1');
});

test('a broken configuration still answers 200 with a call-back instruction per tool call', async () => {
  const broken = { ...ENV, CLIENT_COMPANY: '' };
  const res = await worker.fetch(post('/api/vapi', toolCall), broken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results[0].toolCallId, 'tc_1');
  assert.match(body.results[0].result, /rappelle/);
});

// The daily check (cron) and its manual twin, GET /api/check. Brevo and Resend are fake fetches.
const CHECK_ENV = { ...ENV, BREVO_API_KEY: 'brevo-key', RESEND_API_KEY: 'resend-key', MAIL_FROM: 'Accueil <a@dupont.fr>', SMS_SENDER: 'Dupont', ALERT_EMAIL: 'tony@example.fr' };

async function withFakeApis({ brevoStatus = 200, smsCredits = 100 } = {}, fn) {
  const previous = globalThis.fetch;
  const mails = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://api.brevo.com/v3/account') {
      return brevoStatus === 200
        ? new Response(JSON.stringify({ plan: [{ type: 'sms', creditsType: 'sendLimit', credits: smsCredits }] }), { status: 200 })
        : new Response(JSON.stringify({ code: 'unauthorized', message: 'We have detected you are using an unrecognised IP address 104.28.0.1' }), { status: brevoStatus });
    }
    if (u === 'https://api.resend.com/emails') {
      mails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  try { return await fn(mails); } finally { globalThis.fetch = previous; }
}

async function runScheduled(w, env) {
  const pending = [];
  await w.scheduled({ cron: '0 6 * * *', scheduledTime: Date.now() }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

test('the daily check emails an alert when Brevo refuses the SMS key', async () => {
  await withFakeApis({ brevoStatus: 401 }, async (mails) => {
    await runScheduled(createWorker({ makeStore: () => memoryStore() }), CHECK_ENV);
    assert.equal(mails.length, 1);
    assert.deepEqual(mails[0].to, ['tony@example.fr']);
    assert.match(mails[0].subject, /Plomberie Dupont/);
    assert.match(mails[0].text, /401/);
    assert.match(mails[0].text, /unrecognised IP address/);
  });
});

test('the daily check warns when the SMS credits run low', async () => {
  await withFakeApis({ smsCredits: 3 }, async (mails) => {
    await runScheduled(createWorker({ makeStore: () => memoryStore() }), CHECK_ENV);
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /crédits SMS[^\n]*\b3\b/i);
  });
});

test('the daily check stays quiet when everything works', async () => {
  await withFakeApis({}, async (mails) => {
    await runScheduled(createWorker({ makeStore: () => memoryStore() }), CHECK_ENV);
    assert.equal(mails.length, 0);
  });
});

test('the daily check reports a configuration that refuses every call', async () => {
  await withFakeApis({}, async (mails) => {
    await runScheduled(createWorker({ makeStore: () => memoryStore() }), { ...CHECK_ENV, SMS_SENDER: '' });
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /smsSender/);
  });
});

test('GET /api/check needs the webhook secret and returns the problems without emailing', async () => {
  await withFakeApis({ brevoStatus: 401 }, async (mails) => {
    const w = createWorker({ makeStore: () => memoryStore() });
    const refusedRes = await w.fetch(new Request('https://w.example/api/check'), CHECK_ENV);
    assert.equal(refusedRes.status, 401);
    const res = await w.fetch(new Request('https://w.example/api/check', { headers: { 'x-vapi-secret': 's3cret' } }), CHECK_ENV);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.ok(body.problems.some((p) => p.includes('401')), body.problems.join('\n'));
    assert.equal(mails.length, 0);
  });
});

// Twilio, chosen by its keys: the caller's confirmation goes out through Twilio's API.
const TWILIO_ENV = { ...ENV, TWILIO_ACCOUNT_SID: 'AC_test_account', TWILIO_AUTH_TOKEN: 'tok', SMS_SENDER: 'Dupont', RESEND_API_KEY: 'resend-key', ALERT_EMAIL: 'tony@example.fr' };

async function withFakeTwilio({ balance = '25.00', balanceStatus = 200 } = {}, fn) {
  const previous = globalThis.fetch;
  const seen = { texts: [], mails: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/Messages.json')) {
      seen.texts.push(new URLSearchParams(init.body));
      return new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }), { status: 201 });
    }
    if (u.endsWith('/Balance.json')) {
      return balanceStatus === 200
        ? new Response(JSON.stringify({ balance, currency: 'USD' }), { status: 200 })
        : new Response(JSON.stringify({ code: 20003, message: 'Authenticate', status: balanceStatus }), { status: balanceStatus });
    }
    if (u === 'https://api.resend.com/emails') {
      seen.mails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
    }
    if (u.includes('/v2/slots')) {
      return new Response(JSON.stringify({ status: 'success', data: { '2030-01-07': [{ start: '2030-01-07T09:00:00.000+01:00' }] } }), { status: 200 });
    }
    if (u.includes('/v2/bookings')) {
      return new Response(JSON.stringify({ status: 'success', data: { uid: 'bk_1', start: JSON.parse(init.body).start } }), { status: 201 });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  try { return await fn(seen); } finally { globalThis.fetch = previous; }
}

test('with Twilio keys, the booking confirmation is texted through Twilio under the business name', async () => {
  await withFakeTwilio({}, async (seen) => {
    const w = createWorker({ makeStore: () => memoryStore() });
    const call = { id: 'call_tw', customer: { number: '+33612345678' } };
    const book = { message: { type: 'tool-calls', call, toolCallList: [{ id: 't1', type: 'function', function: { name: 'prendre_rdv', arguments: { creneau: '2030-01-07T08:00:00.000Z', nom: 'Jean Dupont', besoin: 'fuite' } } }] } };
    const res = await w.fetch(post('/api/vapi', book), TWILIO_ENV);
    const body = await res.json();
    assert.match(body.results[0].result, /SMS/);
    assert.equal(seen.texts.length, 1);
    assert.equal(seen.texts[0].get('To'), '+33612345678');
    assert.equal(seen.texts[0].get('From'), 'Dupont');
  });
});

test('the daily check warns when the Twilio balance runs low', async () => {
  await withFakeTwilio({ balance: '3.20' }, async (seen) => {
    await runScheduled(createWorker({ makeStore: () => memoryStore() }), TWILIO_ENV);
    assert.equal(seen.mails.length, 1);
    assert.match(seen.mails[0].text, /3\.20 USD/);
  });
});

test('the daily check emails an alert when Twilio refuses the credentials', async () => {
  await withFakeTwilio({ balanceStatus: 401 }, async (seen) => {
    await runScheduled(createWorker({ makeStore: () => memoryStore() }), TWILIO_ENV);
    assert.equal(seen.mails.length, 1);
    assert.match(seen.mails[0].text, /twilio 401/);
  });
});

test('the daily check stays quiet with a healthy Twilio account', async () => {
  await withFakeTwilio({}, async (seen) => {
    await runScheduled(createWorker({ makeStore: () => memoryStore() }), TWILIO_ENV);
    assert.equal(seen.mails.length, 0);
  });
});

test('the daily check reports a call cut at the time cap', async () => {
  await withFakeApis({}, async (mails) => {
    const store = memoryStore();
    await store.upsertCall('call_long', {
      caller: { nom: 'Paul', telephone: '+33612345678' }, endedAt: new Date().toISOString(),
      endedReason: 'exceeded-max-duration', recapSentAt: new Date().toISOString(),
      deliveries: { recap: { email: { status: 'sent' }, sms: [] } },
    });
    await runScheduled(createWorker({ makeStore: () => store }), CHECK_ENV);
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /call_long/);
    assert.match(mails[0].text, /durée maximale/);
  });
});

// Screening incoming calls (2026-10-24). Method 1: Twilio posts each call to the Worker first.
import { createHmac } from 'node:crypto';

const VOICE_URL = 'https://w.example/api/twilio/voice';
const SCREEN_ENV = { ...TWILIO_ENV, BLOCKED_NUMBERS: '06 00 00 00 01', VAPI_ASSISTANT_ID: 'asst_1' };

function twilioCall(from, { env = SCREEN_ENV, callSid = 'CA_test_call', sign = true } = {}) {
  const params = { AccountSid: 'AC_test_account', CallSid: callSid, From: from, To: '+33556123456' };
  const data = VOICE_URL + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (sign) headers['x-twilio-signature'] = createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(data).digest('base64');
  return new Request(VOICE_URL, { method: 'POST', headers, body: new URLSearchParams(params).toString() });
}

test('Twilio: an allowed call is forwarded to Vapi', async () => {
  const w = createWorker({ makeStore: () => memoryStore() });
  const res = await w.fetch(twilioCall('+33612345678'), SCREEN_ENV);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  assert.match(await res.text(), /<Redirect method="POST">https:\/\/api\.vapi\.ai\/twilio\/inbound_call<\/Redirect>/);
});

test('Twilio: a request without a valid signature is refused', async () => {
  const w = createWorker({ makeStore: () => memoryStore() });
  assert.equal((await w.fetch(twilioCall('+33612345678', { sign: false }), SCREEN_ENV)).status, 403);
});

test('Twilio: a blocked number is rejected without being answered', async () => {
  const w = createWorker({ makeStore: () => memoryStore() });
  assert.match(await (await w.fetch(twilioCall('+33600000001'), SCREEN_ENV)).text(), /<Reject reason="rejected"\/>/);
});

test('Twilio: the fifth call in an hour hears one sentence and the line closes, Vapi never answers', async () => {
  const store = memoryStore();
  const w = createWorker({ makeStore: () => store });
  for (let i = 0; i < 4; i += 1) {
    assert.match(await (await w.fetch(twilioCall('+33612345678', { callSid: `CA_test_${i}` }), SCREEN_ENV)).text(), /<Redirect/);
  }
  const fifth = await (await w.fetch(twilioCall('+33612345678', { callSid: 'CA_test_5' }), SCREEN_ENV)).text();
  assert.match(fifth, /<Say language="fr-FR">[^<]*112[^<]*<\/Say><Hangup\/>/);
  assert.doesNotMatch(fifth, /Redirect/);
});

test('Twilio: when the screen itself breaks, the call still goes through', async () => {
  const w = createWorker({ makeStore: () => memoryStore() });
  const broken = { ...SCREEN_ENV, CLIENT_COMPANY: '' };
  assert.match(await (await w.fetch(twilioCall('+33612345678', { env: broken }), broken)).text(), /<Redirect/);
});

// Method 2: Vapi asks the Worker which assistant answers (assistant-request).
const assistantRequest = (number) => ({ message: { type: 'assistant-request', call: { id: 'call_ar', customer: { number } } } });

test('Vapi: an assistant-request is answered with the saved assistant', async () => {
  const w = createWorker({ makeStore: () => memoryStore() });
  const res = await w.fetch(post('/api/vapi', assistantRequest('+33612345678')), SCREEN_ENV);
  assert.deepEqual(await res.json(), { assistantId: 'asst_1' });
});

test('Vapi: an assistant-request still gets the assistant when the screen breaks', async () => {
  const w = createWorker({ makeStore: () => memoryStore() });
  const broken = { ...SCREEN_ENV, CLIENT_COMPANY: '' };
  assert.deepEqual(await (await w.fetch(post('/api/vapi', assistantRequest('+33612345678')), broken)).json(), { assistantId: 'asst_1' });
});

test('the daily check reports the calls the screen refused', async () => {
  await withFakeApis({}, async (mails) => {
    const store = memoryStore();
    for (let i = 0; i < 3; i += 1) {
      await store.recordAttempt({ number: '+33612345678', at: new Date().toISOString(), decision: 'refused', reason: 'number-hour', via: 'twilio', providerCallId: `CA${i}` });
    }
    await runScheduled(createWorker({ makeStore: () => store }), CHECK_ENV);
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /06 12 34 56 78/);
  });
});
