// The end of each call, forwarded to a CRM when CRM_WEBHOOK_URL is set: open-pipeline's
// /intake/receptionist (github.com/tonystechofficial/open-pipeline), or any receiver of this shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crmPayload } from '../src/core/crm.mjs';
import { crmWebhook } from '../src/providers/crm/webhook.mjs';

const AT = '2026-10-23T08:00:00.000Z';
const CALLER = { nom: 'Jean Dupont', telephone: '+33612345678', email: null, besoin: 'fuite', urgence: 'normale', ville: 'Mérignac', adresse: '12 rue des Lilas' };

test('a booked call: status rdv and the slot with its written label; the street address stays here', () => {
  const payload = crmPayload({
    callId: 'call_1', endedAt: AT, caller: CALLER, summary: 'Fuite sous l\'évier.',
    appointment: { callId: 'call_1', at: '2026-10-23T07:30:00Z', label: 'vendredi 23 octobre à 9 h 30', bookingRef: 'bk_1', caller: CALLER },
  });
  assert.deepEqual(payload, {
    callId: 'call_1',
    endedAt: AT,
    status: 'rdv',
    caller: { nom: 'Jean Dupont', telephone: '+33612345678', email: null, besoin: 'fuite', urgence: 'normale', ville: 'Mérignac' },
    appointment: { at: '2026-10-23T07:30:00Z', label: 'vendredi 23 octobre à 9 h 30' },
    summary: 'Fuite sous l\'évier.',
  });
});

test('a call to return: status a_rappeler, no appointment, missing details as null', () => {
  const payload = crmPayload({ callId: 'call_2', endedAt: AT, caller: { telephone: '+33612345678' }, appointment: null });
  assert.equal(payload.status, 'a_rappeler');
  assert.equal(payload.appointment, null);
  assert.equal(payload.summary, null);
  assert.deepEqual(payload.caller, { nom: null, telephone: '+33612345678', email: null, besoin: null, urgence: null, ville: null });
});

test('the webhook gets the payload with the shared secret; a refusal throws with the answer', async () => {
  let request;
  const send = crmWebhook({ url: 'https://open-pipeline-intake.tony.workers.dev/intake/receptionist', secret: 'shared' }, async (url, init) => {
    request = { url, init };
    return new Response('{"ok":true}');
  });
  await send({ callId: 'call_1' });
  assert.equal(request.url, 'https://open-pipeline-intake.tony.workers.dev/intake/receptionist');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['x-pipeline-secret'], 'shared');
  assert.deepEqual(JSON.parse(request.init.body), { callId: 'call_1' });
  const refused = crmWebhook({ url: 'https://x.example', secret: 'wrong' }, async () => new Response('{"error":"unauthorized"}', { status: 401 }));
  await assert.rejects(refused({}), /CRM 401: \{"error":"unauthorized"\}/);
});
