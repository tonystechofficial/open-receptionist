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

test('the agent can pass the precise time a caller names', () => {
  const check = functionTools(vapi.buildAssistant(config, {})).find((t) => t.function.name === 'verifier_dispos');
  assert.ok(check.function.parameters.properties.heure);
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

// The discovery journey (2026-10-27): for a service business, the call books a first exchange.
const { config: discovery } = validateClientConfig({
  company: "Tony's Tech",
  metier: 'développement web, mobile et IA',
  calendar: { provider: 'calcom', id: '1' },
  notify: { email: ['tony@example.fr'] },
  parcours: 'decouverte',
  interlocuteur: 'Tony',
  presentation: 'une petite entreprise de Bordeaux qui crée des assistants IA',
  echange: { quoi: 'un échange gratuit de vingt minutes avec Tony, par téléphone', pourquoi: "c'est ce qui lui permet de faire un devis" },
  qualification: [
    { offre: 'receptionniste', pour: 'le réceptionniste', situation: "« Aujourd'hui, quand vous ne pouvez pas décrocher, que se passe-t-il ? »" },
    { offre: 'audit', pour: 'un audit', situation: "quel assistant, et s'il sert déjà" },
  ],
  exemples: [{ appelant: "C'est combien ?", reponse: 'Deux mille euros. Vous êtes dans quel domaine ?' }],
  demonstration: true,
  maxDurationSeconds: 600,
  infos: { prestations: ['un réceptionniste vocal IA'], tarifs: { devis: 'gratuit' } },
});
const discoveryPrompt = (c = discovery) => vapi.buildAssistant(c, {}).model.messages[0].content;

test('the discovery journey greets with what the agent can do, and who the call is with', () => {
  const a = vapi.buildAssistant(discovery, {});
  assert.match(a.firstMessage, /intelligence artificielle/);
  assert.match(a.firstMessage, /renseigner/);
  assert.match(a.firstMessage, /Tony/);
  assert.match(a.firstMessage, /\?$/);
});

test('the discovery prompt qualifies the need with the configured questions, then books the exchange', () => {
  const p = discoveryPrompt();
  assert.ok(p.includes('une petite entreprise de Bordeaux qui crée des assistants IA'));
  assert.ok(p.includes("pour le réceptionniste, « Aujourd'hui, quand vous ne pouvez pas décrocher, que se passe-t-il ? »"), p);
  assert.ok(p.includes("pour un audit, quel assistant, et s'il sert déjà"));
  assert.ok(p.includes('un échange gratuit de vingt minutes avec Tony, par téléphone'));
  assert.ok(p.includes("c'est ce qui lui permet de faire un devis"));
  assert.match(p, /trois questions au plus/);
  assert.ok(p.includes("C'est combien ?") && p.includes('Deux mille euros. Vous êtes dans quel domaine ?'));
  assert.ok(p.includes('un réceptionniste vocal IA'));
});

test('the discovery prompt leaves out the trades logic: no urgency scale, no town of the job', () => {
  const p = discoveryPrompt();
  assert.doesNotMatch(p, /fuite active/);
  assert.doesNotMatch(p, /ville de l'intervention/);
});

test('the discovery prompt carries the rules the first real call showed were missing', () => {
  const p = discoveryPrompt();
  assert.ok(p.includes('{{customer.number}}'));
  assert.ok(p.includes('{{"now" | date:'), 'the agent knows the local date and time');
  assert.match(p, /Monsieur/);
  assert.match(p, /« demain » dit entre minuit et six heures/i);
  assert.match(p, /deux derniers chiffres/);
  assert.match(p, /6 minutes/);
  assert.match(p, /n'est pas là ou ne peut pas répondre/);
});

test('a business that sells assistants turns "are you a robot?" into a demonstration; others do not', () => {
  assert.match(discoveryPrompt(), /démonstration/);
  const { config: plain } = validateClientConfig({ ...discovery, demonstration: false });
  assert.doesNotMatch(discoveryPrompt(plain), /démonstration/);
});

test('the intervention journey keeps its greeting and its flow', () => {
  const a = vapi.buildAssistant(config, {});
  assert.match(a.firstMessage, /Que puis-je faire pour vous \?/);
  assert.match(a.model.messages[0].content, /fuite active/);
});

test('in the discovery journey, noter_demande takes the discovery answers, the offer being a configured id', () => {
  const a = vapi.buildAssistant(discovery, {});
  const note = functionTools(a).find((t) => t.function.name === 'noter_demande');
  for (const k of ['entreprise', 'activite', 'offre', 'situation', 'appels_manques', 'echeance']) assert.ok(note.function.parameters.properties[k], k);
  assert.deepEqual(note.function.parameters.properties.offre.enum, ['receptionniste', 'audit']);
  assert.equal(note.function.parameters.properties.ville, undefined, 'no town of the job in this journey');
  const book = functionTools(a).find((t) => t.function.name === 'prendre_rdv');
  assert.ok(book.function.parameters.properties.entreprise);
});

test('the intervention journey keeps its tools as they were', () => {
  const note = functionTools(vapi.buildAssistant(config, {})).find((t) => t.function.name === 'noter_demande');
  assert.equal(note.function.parameters.properties.entreprise, undefined);
  assert.ok(note.function.parameters.properties.ville);
});

// Assistant settings (2026-10-27): what the first real call and Vapi's English defaults called for.
test('the calendar tools say what they are doing while they run, in French and with vous', () => {
  const a = vapi.buildAssistant(config, {});
  const check = functionTools(a).find((t) => t.function.name === 'verifier_dispos');
  const starts = check.messages.filter((m) => m.type === 'request-start').map((m) => m.content);
  assert.ok(starts.length >= 2, 'variants, so the agent does not repeat itself');
  assert.ok(starts.every((s) => /agenda|disponibilités/.test(s)), starts.join(' | '));
  assert.ok(check.messages.some((m) => m.type === 'request-response-delayed' && m.timingMilliseconds > 0));
  const book = functionTools(a).find((t) => t.function.name === 'prendre_rdv');
  assert.ok(book.messages.some((m) => m.type === 'request-start' && /réserve/.test(m.content)));
  assert.doesNotMatch(JSON.stringify([check.messages, book.messages]), /donne-moi|attends/);
});

test('in the discovery journey, noting an answer does not make the caller wait', () => {
  const note = (c) => functionTools(vapi.buildAssistant(c, {})).find((t) => t.function.name === 'noter_demande');
  assert.equal(note(discovery).async, true);
  assert.notEqual(note(config).async, true, 'the trades journey needs the service-area answer');
});

test('a silent caller is asked whether they are still there, twice at most, before the call ends', () => {
  const a = vapi.buildAssistant(config, {});
  const hook = a.hooks.find((h) => h.on === 'customer.speech.timeout');
  assert.ok(hook.options.timeoutSeconds < a.silenceTimeoutSeconds);
  assert.equal(hook.options.triggerMaxCount, 2);
  assert.equal(hook.options.triggerResetMode, 'onUserSpeech');
  assert.ok(hook.do[0].exact.some((s) => /toujours là/.test(s)));
});

test('the transcriber knows the business name, and the words a client adds', () => {
  const a = vapi.buildAssistant(discovery, {});
  assert.ok(a.transcriber.keyterm.includes("Tony's Tech"));
  assert.ok(a.transcriber.keyterm.includes('Tony'));
  const { config: more } = validateClientConfig({ ...discovery, motsCles: ['Cal.com'] });
  assert.ok(vapi.buildAssistant(more, {}).transcriber.keyterm.includes('Cal.com'));
});

test('French acknowledgements do not cut the agent off, French interruptions do', () => {
  const plan = vapi.buildAssistant(config, {}).stopSpeakingPlan;
  assert.ok(plan.acknowledgementPhrases.includes("d'accord"));
  assert.ok(plan.interruptionPhrases.includes('attendez'));
  assert.ok(plan.numWords >= 1, 'counted on words, so an acknowledgement is recognised before it interrupts');
});

test("Vapi's end-of-turn model is on for French, and a client can turn it off", () => {
  assert.equal(vapi.buildAssistant(config, {}).startSpeakingPlan.smartEndpointingPlan.provider, 'vapi');
  const { config: off } = validateClientConfig({ ...config, smartEndpointing: false });
  assert.equal(vapi.buildAssistant(off, {}).startSpeakingPlan, undefined);
});

test('the closing words suit any hour, and the model can be changed per client', () => {
  const a = vapi.buildAssistant(config, {});
  assert.equal(a.endCallMessage, 'Merci de votre appel, à bientôt.');
  assert.equal(a.model.model, 'gpt-4o-mini');
  const { config: other } = validateClientConfig({ ...config, model: 'gpt-4.1-mini' });
  assert.equal(vapi.buildAssistant(other, {}).model.model, 'gpt-4.1-mini');
});

test('a transfer is announced once, by the transfer tool itself', () => {
  const prompt = vapi.buildAssistant(withTransfer, {}).model.messages[0].content;
  assert.doesNotMatch(prompt, /annonce la mise en relation/);
  assert.match(prompt, /transferCall sans rien annoncer/);
});
