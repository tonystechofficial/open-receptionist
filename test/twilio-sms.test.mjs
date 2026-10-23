// The Twilio SMS adapter against a fake fetch: what it sends, and how its credentials are checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { twilioSms } from '../src/providers/notify/twilio-sms.mjs';

// A fake SID that is not shaped like a real one (AC + 32 hex), which GitHub's push protection blocks.
const SID = 'AC_test_account';

async function withFetch(respond, fn) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  try { return await fn(calls); } finally { globalThis.fetch = previous; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const basic = `Basic ${Buffer.from(`${SID}:tok`).toString('base64')}`;

test('sends a form with the E.164 number, the business name as sender and the text', async () => {
  await withFetch(() => json({ sid: 'SM1', status: 'queued' }, 201), async (calls) => {
    await twilioSms({ accountSid: SID, authToken: 'tok' }).sendSms({ to: '+33612345678', content: 'Bonjour', sender: 'Dupont' });
    assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.authorization, basic);
    assert.equal(calls[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
    const form = new URLSearchParams(calls[0].init.body);
    assert.equal(form.get('To'), '+33612345678');
    assert.equal(form.get('From'), 'Dupont');
    assert.equal(form.get('Body'), 'Bonjour');
  });
});

test('a number stored without its plus still goes out in E.164', async () => {
  await withFetch(() => json({ sid: 'SM1' }, 201), async (calls) => {
    await twilioSms({ accountSid: SID, authToken: 'tok', sender: 'Dupont' }).sendSms({ to: '33612345678', content: 'x' });
    assert.equal(new URLSearchParams(calls[0].init.body).get('To'), '+33612345678');
  });
});

test('never falls back to a generic sender: no name, no SMS', async () => {
  await withFetch(() => json({ sid: 'SM1' }, 201), async (calls) => {
    await assert.rejects(twilioSms({ accountSid: SID, authToken: 'tok' }).sendSms({ to: '+33612345678', content: 'x' }), /sender/);
    assert.equal(calls.length, 0);
  });
});

test('a refused message fails with the status and Twilio\'s message', async () => {
  const refused = { code: 21211, message: "The 'To' number is not a valid phone number.", status: 400 };
  await withFetch(() => json(refused, 400), async () => {
    await assert.rejects(
      twilioSms({ accountSid: SID, authToken: 'tok', sender: 'Dupont' }).sendSms({ to: '+33612345678', content: 'x' }),
      /twilio sms 400.*not a valid phone number/,
    );
  });
});

test('check reads the balance and its currency', async () => {
  await withFetch(() => json({ account_sid: SID, balance: '12.29', currency: 'USD' }), async (calls) => {
    const r = await twilioSms({ accountSid: SID, authToken: 'tok' }).check();
    assert.equal(calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Balance.json`);
    assert.equal(calls[0].init.headers.authorization, basic);
    assert.deepEqual(r, { balance: 12.29, currency: 'USD' });
  });
});

test('check fails with the status when the credentials are refused', async () => {
  await withFetch(() => json({ code: 20003, message: 'Authenticate', status: 401 }, 401), async () => {
    await assert.rejects(twilioSms({ accountSid: SID, authToken: 'bad' }).check(), /twilio 401.*Authenticate/);
  });
});
