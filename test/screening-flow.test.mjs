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
