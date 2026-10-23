// The Brevo SMS adapter against a fake fetch: what it sends, and how its key is checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { brevoSms } from '../src/providers/notify/brevo-sms.mjs';

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

test('sends international digits and the business name as sender', async () => {
  await withFetch(() => json({ messageId: 1 }, 201), async (calls) => {
    await brevoSms({ apiKey: 'k', sender: 'Dupont' }).sendSms({ to: '+33612345678', content: 'Bonjour' });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/transactionalSMS/sms');
    assert.equal(body.recipient, '33612345678');
    assert.equal(body.sender, 'Dupont');
    assert.equal(body.type, 'transactional');
  });
});

test('never falls back to a generic sender: no name, no SMS', async () => {
  await withFetch(() => json({ messageId: 1 }, 201), async (calls) => {
    await assert.rejects(brevoSms({ apiKey: 'k' }).sendSms({ to: '+33612345678', content: 'Bonjour' }), /sender/);
    assert.equal(calls.length, 0);
  });
});

test('check reads the SMS credits left on the account', async () => {
  const account = { email: 'a@b.fr', plan: [{ type: 'free', creditsType: 'sendLimit', credits: 300 }, { type: 'sms', creditsType: 'sendLimit', credits: 42 }] };
  await withFetch(() => json(account), async (calls) => {
    const r = await brevoSms({ apiKey: 'k' }).check();
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/account');
    assert.equal(calls[0].init.headers['api-key'], 'k');
    assert.equal(r.smsCredits, 42);
  });
});

test('check fails with the status and Brevo\'s message when the key is refused', async () => {
  const blocked = { code: 'unauthorized', message: 'We have detected you are using an unrecognised IP address 104.28.0.1' };
  await withFetch(() => json(blocked, 401), async () => {
    await assert.rejects(brevoSms({ apiKey: 'k' }).check(), /401.*unrecognised IP address/);
  });
});
