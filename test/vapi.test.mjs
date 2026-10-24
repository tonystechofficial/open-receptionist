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

const functionTools = (a) => a.model.tools.filter((t) => t.type === 'function');

test('the assistant exposes the three tools the flows rely on', () => {
  const a = vapi.buildAssistant(config, { webhookBaseUrl: 'https://w.example', credentialId: 'cred_1' });
  const names = functionTools(a).map((t) => t.function.name).sort();
  assert.deepEqual(names, ['noter_demande', 'prendre_rdv', 'verifier_dispos']);
});

test('every webhook goes to one endpoint, authenticated by a Vapi credential', () => {
  const a = vapi.buildAssistant(config, { webhookBaseUrl: 'https://w.example/', credentialId: 'cred_1' });
  assert.deepEqual(a.server, { url: 'https://w.example/api/vapi', credentialId: 'cred_1' });
  for (const t of functionTools(a)) assert.deepEqual(t.server, { url: 'https://w.example/api/vapi', credentialId: 'cred_1' });
  assert.ok(a.serverMessages.includes('end-of-call-report'));
});

// Limits on call length (2026-10-23): a hard cap, a silence timeout, and an agent that can hang up.
test('a call ends after 30 seconds of silence, and at 5 minutes in any case', () => {
  const a = vapi.buildAssistant(config, {});
  assert.equal(a.silenceTimeoutSeconds, 30);
  assert.equal(a.maxDurationSeconds, 300);
});

test('a client can shorten both limits', () => {
  const { config: short } = validateClientConfig({ ...config, maxDurationSeconds: 240, silenceTimeoutSeconds: 20 });
  const a = vapi.buildAssistant(short, {});
  assert.equal(a.maxDurationSeconds, 240);
  assert.equal(a.silenceTimeoutSeconds, 20);
});

test('the agent can hang up by itself, and the prompt says when', () => {
  const a = vapi.buildAssistant(config, {});
  assert.ok(a.model.tools.some((t) => t.type === 'endCall'));
  const prompt = a.model.messages[0].content;
  assert.match(prompt, /endCall/);
  assert.match(prompt, /canular|abusi/);
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

// Business information (2026-10-24): what the agent may say about services, area and prices.
const INFOS = {
  prestations: ['Recherche de fuite', 'Débouchage'], horsPrestations: ['Climatisation'], zone: ['Bordeaux', 'Mérignac'],
  tarifs: { deplacement: '49 € TTC', tauxHoraire: "65 € TTC de l'heure", forfaits: ['Débouchage évier : 89 € TTC'], devis: 'gratuit' },
  paiement: ['carte bancaire'], faq: [{ question: 'Intervenez-vous le week-end ?', reponse: 'Oui, le samedi matin.' }],
};

test('the prompt carries the business information as written, and the rule to give it only as written', () => {
  const { config: withInfos } = validateClientConfig({ ...config, infos: INFOS });
  const prompt = vapi.buildAssistant(withInfos, {}).model.messages[0].content;
  for (const text of ['Recherche de fuite', 'Climatisation', 'Mérignac', '49 € TTC', "65 € TTC de l'heure", 'Débouchage évier : 89 € TTC', 'carte bancaire', 'Oui, le samedi matin.']) {
    assert.ok(prompt.includes(text), text);
  }
  assert.match(prompt, /telles? quelles?/i);
  assert.match(prompt, /devis/);
  assert.match(prompt, /ville/i);
});

test('without published rates the agent gives no price at all', () => {
  const prompt = vapi.buildAssistant(config, {}).model.messages[0].content;
  assert.match(prompt, /aucun prix/i);
});

test('the tools take the town and the address of the job', () => {
  const a = vapi.buildAssistant(config, {});
  for (const t of functionTools(a)) {
    if (t.function.name === 'noter_demande' || t.function.name === 'prendre_rdv') {
      assert.ok(t.function.parameters.properties.ville, t.function.name);
      assert.ok(t.function.parameters.properties.adresse, t.function.name);
    }
    if (t.function.name === 'verifier_dispos') assert.ok(t.function.parameters.properties.ville);
  }
});

// Transfer to the business (2026-10-25): only when a number is configured, gated by the webhook,
// and with a way back to the assistant when nobody answers.
const { config: withTransfer } = validateClientConfig({
  company: 'Plomberie Dupont',
  metier: 'plomberie',
  calendar: { provider: 'calcom', id: '1' },
  notify: { email: ['patron@dupont.fr'] },
  transfert: { numero: '06 00 00 00 02' },
});

test('without a transfer number, the agent has no way to transfer a call', () => {
  const a = vapi.buildAssistant(config, { webhookBaseUrl: 'https://w.example', credentialId: 'cred_1' });
  assert.equal(a.model.tools.some((t) => t.type === 'transferCall'), false);
  assert.equal(functionTools(a).some((t) => t.function.name === 'demander_transfert'), false);
  assert.doesNotMatch(a.model.messages[0].content, /demander_transfert/);
});

test('with one, the agent asks the webhook first, then transfers, and comes back when nobody answers', () => {
  const a = vapi.buildAssistant(withTransfer, { webhookBaseUrl: 'https://w.example', credentialId: 'cred_1' });
  const ask = functionTools(a).find((t) => t.function.name === 'demander_transfert');
  assert.deepEqual(ask.function.parameters.properties.motif.enum, ['urgence', 'demande_appelant']);
  const [destination] = a.model.tools.find((t) => t.type === 'transferCall').destinations;
  assert.equal(destination.type, 'number');
  assert.equal(destination.number, '+33600000002');
  assert.equal(destination.transferPlan.mode, 'warm-transfer-experimental');
  assert.equal(destination.transferPlan.fallbackPlan.endCallEnabled, false);
  const briefing = destination.transferPlan.transferAssistant.model.messages[0].content;
  assert.match(briefing, /transferSuccessful/);
  assert.match(briefing, /transferCancel/);
  assert.match(a.model.messages[0].content, /demander_transfert/);
});
