import test from 'node:test';
import assert from 'node:assert/strict';
import * as vapi from '../src/providers/voice/vapi.mjs';
import { validateClientConfig } from '../src/core/config.mjs';

const { config } = validateClientConfig({
  company: 'Plomberie Dupont',
  metier: 'plomberie',
  calendar: { provider: 'calcom', id: '1' },
  notify: { email: ['patron@dupont.fr'] },
  urgences: 'Odeur de gaz : faire sortir tout le monde, puis appeler Urgence Sécurité Gaz au 0 800 47 33 33.',
});

test('the assistant exposes the three tools the flows rely on', () => {
  const a = vapi.buildAssistant(config, { webhookBaseUrl: 'https://w.example', credentialId: 'cred_1' });
  const names = a.model.tools.map((t) => t.function.name).sort();
  assert.deepEqual(names, ['noter_demande', 'prendre_rdv', 'verifier_dispos']);
});

test('every webhook goes to one endpoint, authenticated by a Vapi credential', () => {
  const a = vapi.buildAssistant(config, { webhookBaseUrl: 'https://w.example/', credentialId: 'cred_1' });
  assert.deepEqual(a.server, { url: 'https://w.example/api/vapi', credentialId: 'cred_1' });
  for (const t of a.model.tools) assert.deepEqual(t.server, { url: 'https://w.example/api/vapi', credentialId: 'cred_1' });
  assert.ok(a.serverMessages.includes('end-of-call-report'));
});

test('falls back to the legacy inline secret when no credential is given', () => {
  const a = vapi.buildAssistant(config, { webhookBaseUrl: 'https://w.example', serverSecret: 's3cret' });
  assert.deepEqual(a.server, { url: 'https://w.example/api/vapi', secret: 's3cret' });
});

test('the prompt discloses the AI, uses the caller number and carries the safety instructions', () => {
  const a = vapi.buildAssistant(config, { webhookBaseUrl: 'https://w.example' });
  assert.match(a.firstMessage, /intelligence artificielle/);
  const prompt = a.model.messages[0].content;
  assert.ok(prompt.includes('{{customer.number}}'));
  assert.ok(prompt.includes('0 800 47 33 33'));
  assert.ok(!('structuredDataPlan' in (a.analysisPlan ?? {})));
});

test('the assistant name stays within the 40 characters Vapi accepts', () => {
  const long = { ...config, company: 'Plomberie Chauffage Sanitaire Dupont et Fils de Bordeaux' };
  assert.ok(vapi.buildAssistant(long, {}).name.length <= 40);
});

test('reads the call id and the caller number from a Vapi message', () => {
  const m = { type: 'tool-calls', call: { id: 'call_9', customer: { number: '+33612345678' } } };
  assert.equal(vapi.getCallId(m), 'call_9');
  assert.equal(vapi.getCallerNumber(m), '+33612345678');
  assert.equal(vapi.getCallerNumber({ call: { customer: {} } }), null);
});

test('tool results carry the tool name and the call id Vapi sent', () => {
  assert.deepEqual(
    vapi.toolResults([{ name: 'x', toolCallId: 'a', result: 'ok' }]),
    { results: [{ name: 'x', toolCallId: 'a', result: 'ok' }] },
  );
});
