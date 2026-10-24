// Method 2: Vapi asks the webhook which assistant answers an incoming call (assistant-request).
// The store is in memory, so the counts are the real ones the flow would use.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/server/handlers.mjs';
import { memoryStore } from '../src/db/store.mjs';
import { validateClientConfig } from '../src/core/config.mjs';
import { DEFAULT_LIMITS } from '../src/core/screening.mjs';

const { config } = validateClientConfig({
  company: 'Plomberie Dupont', metier: 'plomberie', calendar: { provider: 'calcom', id: '1' },
  notify: { email: ['patron@dupont.fr'] },
});

function deps({ assistantId = 'asst_1', blocked = [], limits = DEFAULT_LIMITS } = {}) {
  let clock = new Date('2026-10-24T08:00:00Z');
  return {
    config, store: memoryStore(), log: () => {},
    now: () => clock,
    advance(minutes) { clock = new Date(clock.getTime() + minutes * 60_000); },
    screening: { assistantId, blocked, limits },
  };
}
const request = (number, id = 'call_x') => ({ type: 'assistant-request', call: { id, customer: { number } } });

test('an allowed caller is handed the saved assistant', async () => {
  assert.deepEqual(await H.handleVapiMessage(request('+33612345678'), deps()), { assistantId: 'asst_1' });
});

test('the caller is also read where Vapi\'s own example puts it', async () => {
  const d = deps({ blocked: ['+33612345678'] });
  const r = await H.handleVapiMessage({ type: 'assistant-request', call: { id: 'c', from: { phoneNumber: '+33612345678' } } }, d);
  assert.ok(r.error, JSON.stringify(r));
});

test('the fifth call in an hour from the same number hears a refusal, spoken by Vapi', async () => {
  const d = deps();
  for (let i = 0; i < 4; i += 1) {
    assert.deepEqual(await H.handleVapiMessage(request('+33612345678', `c${i}`), d), { assistantId: 'asst_1' });
    d.advance(5);
  }
  const r = await H.handleVapiMessage(request('+33612345678', 'c5'), d);
  assert.match(r.error, /112/);
  assert.equal(r.assistantId, undefined);
  d.advance(61);
  assert.deepEqual(await H.handleVapiMessage(request('+33612345678', 'c6'), d), { assistantId: 'asst_1' });
});

test('every screened call is recorded, refused ones with their reason', async () => {
  const d = deps({ blocked: ['+33700000000'] });
  await H.handleVapiMessage(request('+33612345678'), d);
  await H.handleVapiMessage(request('+33700000000'), d);
  const attempts = await d.store.attemptsSince('2026-10-24T00:00:00Z');
  assert.deepEqual(attempts.map((a) => [a.number, a.decision, a.reason, a.via]), [
    ['+33612345678', 'allowed', null, 'vapi'],
    ['+33700000000', 'refused', 'blocked', 'vapi'],
  ]);
});

test('without VAPI_ASSISTANT_ID the call cannot be routed: the caller is told, and the attempt says why', async () => {
  const d = deps({ assistantId: null }); // undefined would fall back to the helper's default id
  const r = await H.handleVapiMessage(request('+33612345678'), d);
  assert.match(r.error, /112/);
  const [attempt] = await d.store.attemptsSince('2026-10-24T00:00:00Z');
  assert.equal(attempt.reason, 'no-assistant');
});

// The immediate flood alert (2026-10-24): the first refusal of a wave in the hour alerts the operator.
function alerting(limits) {
  const d = deps({ limits: { ...DEFAULT_LIMITS, ...limits } });
  d.sent = [];
  d.alert = async (mail) => { d.sent.push(mail); };
  return d;
}

test('the first call turned away by the hourly total alerts the operator once, not at every refusal', async () => {
  const d = alerting({ totalHour: 2 });
  await H.handleVapiMessage(request('+33600000001', 'a'), d);
  await H.handleVapiMessage(request('+33600000002', 'b'), d);
  assert.equal(d.sent.length, 0);
  assert.ok((await H.handleVapiMessage(request('+33600000003', 'c'), d)).error);
  await H.handleVapiMessage(request('+33600000004', 'd'), d);
  assert.equal(d.sent.length, 1);
  assert.match(d.sent[0].subject, /vague/i);
});

test('a wave of withheld numbers alerts the operator too', async () => {
  const d = alerting({ anonymousHour: 1 });
  await H.handleVapiMessage(request(null, 'a'), d);
  await H.handleVapiMessage(request(null, 'b'), d);
  assert.equal(d.sent.length, 1);
  assert.match(d.sent[0].text, /masqu/);
});

test('one number calling too often does not alert in real time: the daily report covers it', async () => {
  const d = alerting({ perNumberHour: 1 });
  await H.handleVapiMessage(request('+33612345678', 'a'), d);
  await H.handleVapiMessage(request('+33612345678', 'b'), d);
  assert.equal(d.sent.length, 0);
});

test('an alert that cannot be sent never blocks the call screening', async () => {
  const d = alerting({ totalHour: 1 });
  d.alert = async () => { throw new Error('resend 500'); };
  await H.handleVapiMessage(request('+33600000001', 'a'), d);
  assert.match((await H.handleVapiMessage(request('+33600000002', 'b'), d)).error, /112/);
});
