// End-to-end flows through the webhook handlers, with a fake calendar and fake notifiers.
// These reproduce the gaps found on 2026-10-22: raw timestamps offered to the caller, a taken
// slot crashing the tool call, no confirmation to the caller, double bookings, duplicate recaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/server/handlers.mjs';
import { memoryStore } from '../src/db/store.mjs';
import { validateClientConfig } from '../src/core/config.mjs';

const GSM7 = /^[@£$¥èéùìòÇØø\n\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-.\/0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;
const NOW = new Date('2026-10-22T07:00:00Z'); // jeudi, 9 h à Paris
const SLOTS = [
  '2026-10-22T12:00:00Z', '2026-10-22T12:30:00Z', '2026-10-22T13:00:00Z', '2026-10-22T15:00:00Z',
  '2026-10-23T07:30:00Z', '2026-10-23T08:00:00Z', '2026-10-23T12:00:00Z', '2026-10-26T08:00:00Z',
  '2026-10-27T13:00:00Z', '2026-10-28T09:00:00Z', '2026-10-29T09:00:00Z', '2026-10-30T09:00:00Z',
];

function fakeCalendar(initial, { bookingFailsWith, slotsFail } = {}) {
  let free = initial.slice();
  const booked = [];
  return {
    booked,
    takeExternally(iso) { free = free.filter((s) => +new Date(s) !== +new Date(iso)); },
    async getAvailableSlots() {
      if (slotsFail) throw new Error('cal.com slots 503');
      return free.slice();
    },
    async createBooking(b) {
      if (bookingFailsWith) {
        const e = new Error(`cal.com booking ${bookingFailsWith}`);
        e.status = bookingFailsWith;
        throw e;
      }
      if (!free.some((s) => +new Date(s) === +new Date(b.start))) {
        const e = new Error('cal.com booking 400: User either already has booking at this time or is not available');
        e.status = 400;
        throw e;
      }
      free = free.filter((s) => +new Date(s) !== +new Date(b.start));
      booked.push(b);
      return { status: 'success', data: { uid: `bk_${booked.length}`, start: b.start } };
    },
  };
}

function setup({ slots = SLOTS, calendar, config = {} } = {}) {
  const cal = calendar ?? fakeCalendar(slots);
  const sent = { email: [], sms: [] };
  const { config: cfg } = validateClientConfig({
    company: 'Plomberie Dupont',
    metier: 'plomberie',
    telephone: '0556123456',
    calendar: { provider: 'calcom', id: '1' },
    notify: { email: ['patron@dupont.fr'], sms: ['33600000000'] },
    ...config,
  });
  const deps = {
    calendar: cal,
    store: memoryStore(),
    config: cfg,
    now: () => NOW,
    log: () => {},
    notify: {
      email: async (m) => { sent.email.push(m); },
      sms: async (m) => { sent.sms.push(m); },
    },
  };
  return { cal, sent, deps };
}

const CALL = { id: 'call_1', type: 'inboundPhoneCall', customer: { number: '+33612345678' } };
const tool = (name, args, { id = 't1', call = CALL } = {}) => ({
  type: 'tool-calls',
  call,
  toolCallList: [{ id, type: 'function', function: { name, arguments: args } }],
});
const endOfCall = (extra = {}, call = CALL) => ({ type: 'end-of-call-report', endedReason: 'customer-ended-call', call, ...extra });
const first = (out) => out.results[0];
const callerSms = (sent) => sent.sms.filter((s) => String(s.to).replace(/\D/g, '') === '33612345678');

test('availability offers at most two French-labelled options, never raw timestamps', async () => {
  const { deps } = setup();
  const r = first(await H.handleToolCall(tool('verifier_dispos', { urgence: 'normale' }), deps));
  assert.equal(r.name, 'verifier_dispos');
  assert.equal(r.toolCallId, 't1');
  assert.ok(r.result.includes("option 1, aujourd'hui à 14 heures"), r.result);
  assert.ok(r.result.includes("option 2, aujourd'hui à 17 heures"), r.result);
  assert.ok(!r.result.includes('option 3'), r.result);
  assert.doesNotMatch(r.result, /\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(r.result, /\n/);
});

test('availability honours a preferred day and part of the day', async () => {
  const { deps } = setup();
  const r = first(await H.handleToolCall(tool('verifier_dispos', { jour: 'demain', moment: 'matin' }), deps));
  assert.ok(r.result.includes('option 1, demain à 9 heures 30'), r.result);
  assert.ok(r.result.includes('option 2, demain à 10 heures'), r.result);
});

test('availability says when nothing matches the wish and offers the nearest slots instead', async () => {
  const { deps } = setup();
  const r = first(await H.handleToolCall(tool('verifier_dispos', { jour: 'dimanche' }), deps));
  assert.match(r.result, /ne correspond/);
  assert.ok(r.result.includes("option 1, aujourd'hui à 14 heures"), r.result);
});

test('an emergency with no slot within four hours gets a priority call-back promise', async () => {
  const { deps } = setup({ slots: ['2026-10-27T13:00:00Z'] });
  const r = first(await H.handleToolCall(tool('verifier_dispos', { urgence: 'immediate' }), deps));
  assert.match(r.result, /priorit/);
  assert.match(r.result, /rappel/);
  assert.ok(r.result.includes('option 1, mardi 27 octobre à 14 heures'), r.result);
});

test('when nothing is free the agent is told to offer a call-back', async () => {
  const { deps } = setup({ slots: [] });
  const r = first(await H.handleToolCall(tool('verifier_dispos', {}), deps));
  assert.match(r.result, /aucun créneau/i);
  assert.match(r.result, /rappel/);
});

test('a calendar that cannot be read never breaks the call', async () => {
  const { deps } = setup({ calendar: fakeCalendar(SLOTS, { slotsFail: true }) });
  const r = first(await H.handleToolCall(tool('verifier_dispos', {}), deps));
  assert.match(r.result, /rappel/);
});

test('booking by option number books the offered instant in UTC, with the caller ID as phone', async () => {
  const { cal, deps } = setup();
  await H.handleToolCall(tool('verifier_dispos', {}), deps);
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '1', nom: 'Jean Dupont', besoin: 'fuite' }, { id: 't2' }), deps));
  assert.equal(cal.booked.length, 1);
  assert.equal(cal.booked[0].start, '2026-10-22T12:00:00.000Z');
  assert.equal(cal.booked[0].phone, '+33612345678');
  assert.match(r.result, /Rendez-vous confirmé pour aujourd'hui à 14 heures/);
});

test('a slot taken between the offer and the booking is re-offered, not an error', async () => {
  const { cal, deps } = setup();
  await H.handleToolCall(tool('verifier_dispos', {}), deps);
  cal.takeExternally('2026-10-22T12:00:00Z');
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '1', nom: 'Jean Dupont', besoin: 'fuite' }, { id: 't2' }), deps));
  assert.equal(cal.booked.length, 0);
  assert.match(r.result, /vient d'être pris/);
  assert.ok(r.result.includes("option 1, aujourd'hui à 14 heures 30"), r.result);
});

test('after a re-offer, option 1 means the new first slot', async () => {
  const { cal, deps } = setup();
  await H.handleToolCall(tool('verifier_dispos', {}), deps);
  cal.takeExternally('2026-10-22T12:00:00Z');
  await H.handleToolCall(tool('prendre_rdv', { creneau: '1', nom: 'Jean Dupont', besoin: 'fuite' }, { id: 't2' }), deps);
  await H.handleToolCall(tool('prendre_rdv', { creneau: '1', nom: 'Jean Dupont', besoin: 'fuite' }, { id: 't3' }), deps);
  assert.equal(cal.booked.length, 1);
  assert.equal(cal.booked[0].start, '2026-10-22T12:30:00.000Z');
});

test('the caller gets one confirmation SMS, in the SMS alphabet', async () => {
  const { sent, deps } = setup();
  const r = first(await H.handleToolCall(tool('prendre_rdv', {
    creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'fuite', telephone: '06 12 34 56 78',
  }), deps));
  const sms = callerSms(sent);
  assert.equal(sms.length, 1);
  assert.ok(sms[0].content.includes('Plomberie Dupont'));
  assert.ok(sms[0].content.includes('vendredi 23 octobre à 9 h 30'));
  assert.match(sms[0].content, GSM7);
  assert.match(r.result, /SMS/);
});

test('no SMS to the caller when the client turned confirmations off', async () => {
  const { sent, deps } = setup({ config: { confirmation: { sms: false } } });
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'fuite' }), deps));
  assert.equal(callerSms(sent).length, 0);
  assert.doesNotMatch(r.result, /SMS/);
});

test('booking is refused until a name and a way to call back are known', async () => {
  const { cal, deps } = setup();
  const anonymous = { id: 'call_2', type: 'inboundPhoneCall', customer: {} };
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z', besoin: 'fuite' }, { call: anonymous }), deps));
  assert.equal(cal.booked.length, 0);
  assert.match(r.result, /nom/);
  assert.match(r.result, /numéro/);
});

test('asking twice for the same slot books once and confirms twice', async () => {
  const { cal, deps } = setup();
  const args = { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'fuite' };
  await H.handleToolCall(tool('prendre_rdv', args, { id: 'a' }), deps);
  const r = first(await H.handleToolCall(tool('prendre_rdv', args, { id: 'b' }), deps));
  assert.equal(cal.booked.length, 1);
  assert.match(r.result, /confirmé/);
});

test('changing slot after a booking never double-books', async () => {
  const { cal, deps } = setup();
  const who = { nom: 'Jean Dupont', besoin: 'fuite' };
  await H.handleToolCall(tool('prendre_rdv', { ...who, creneau: '2026-10-23T07:30:00Z' }, { id: 'a' }), deps);
  const r = first(await H.handleToolCall(tool('prendre_rdv', { ...who, creneau: '2026-10-27T13:00:00Z' }, { id: 'b' }), deps));
  assert.equal(cal.booked.length, 1);
  assert.match(r.result, /déjà/);
});

test('a calendar outage at booking time leaves a call-back promise, not a crash', async () => {
  const { cal, deps } = setup({ calendar: fakeCalendar(SLOTS, { bookingFailsWith: 500 }) });
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'fuite' }), deps));
  assert.equal(cal.booked.length, 0);
  assert.match(r.result, /rappel/);
});

test('noter_demande captures the caller for the recap, and an emergency is flagged', async () => {
  const { sent, deps } = setup();
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: "fuite d'eau dans la cuisine", urgence: 'immediate' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  assert.equal(sent.email.length, 1);
  assert.match(sent.email[0].subject, /^\[URGENT\]/);
  assert.match(sent.email[0].text, /Jean Dupont/);
  assert.match(sent.email[0].text, /06 12 34 56 78/);
  assert.match(sent.email[0].text, /à rappeler/);
});

test('the owner recap states the booked slot', async () => {
  const { sent, deps } = setup();
  await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  assert.match(sent.email[0].text, /Rendez-vous : vendredi 23 octobre à 9 h 30/);
  assert.doesNotMatch(sent.email[0].subject, /URGENT/);
});

test('a duplicated end-of-call delivery sends the recap once', async () => {
  const { sent, deps } = setup();
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  await H.handleCallReport(endOfCall(), deps);
  assert.equal(sent.email.length, 1);
  assert.equal(sent.sms.filter((s) => s.to === '33600000000').length, 1);
});

test('a call with no tool use is still recapped from the caller ID and the call analysis', async () => {
  const { sent, deps } = setup();
  await H.handleCallReport(endOfCall({
    analysis: { summary: 'Demande de devis pour une salle de bain.', structuredData: { nom: 'Paul Martin', besoin: 'devis salle de bain' } },
  }), deps);
  assert.equal(sent.email.length, 1);
  assert.match(sent.email[0].text, /Paul Martin/);
  assert.match(sent.email[0].text, /06 12 34 56 78/);
  assert.match(sent.email[0].text, /Résumé : Demande de devis/);
});

test('handleVapiMessage routes each Vapi message type', async () => {
  const { deps } = setup();
  const tools = await H.handleVapiMessage(tool('verifier_dispos', {}), deps);
  assert.ok(Array.isArray(tools.results));
  const report = await H.handleVapiMessage(endOfCall(), deps);
  assert.equal(report.ok, true);
  assert.deepEqual(await H.handleVapiMessage({ type: 'status-update' }, deps), { ignored: true });
});
