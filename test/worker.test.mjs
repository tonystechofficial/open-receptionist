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
