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
  assert.ok(r.result.includes("option 1, aujourd'hui, jeudi 22 octobre, à 14 heures"), r.result);
  assert.ok(r.result.includes("option 2, aujourd'hui, jeudi 22 octobre, à 17 heures"), r.result);
  assert.ok(!r.result.includes('option 3'), r.result);
  assert.doesNotMatch(r.result, /\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(r.result, /\n/);
});

test('availability honours a preferred day and part of the day', async () => {
  const { deps } = setup();
  const r = first(await H.handleToolCall(tool('verifier_dispos', { jour: 'demain', moment: 'matin' }), deps));
  assert.ok(r.result.includes('option 1, demain, vendredi 23 octobre, à 9 heures 30'), r.result);
  assert.ok(r.result.includes('option 2, demain, vendredi 23 octobre, à 10 heures'), r.result);
});

test('availability says when nothing matches the wish and offers the nearest slots instead', async () => {
  const { deps } = setup();
  const r = first(await H.handleToolCall(tool('verifier_dispos', { jour: 'dimanche' }), deps));
  assert.match(r.result, /ne correspond/);
  assert.ok(r.result.includes("option 1, aujourd'hui, jeudi 22 octobre, à 14 heures"), r.result);
});

// A named time (2026-10-27): the first real call asked for "demain à midi" and got two options again.
test('a free slot at the time the caller named comes back alone, to confirm', async () => {
  const { deps } = setup();
  const r = first(await H.handleToolCall(tool('verifier_dispos', { jour: 'demain', heure: '14:00' }), deps));
  assert.ok(r.result.includes('option 1, demain, vendredi 23 octobre, à 14 heures'), r.result);
  assert.ok(!r.result.includes('option 2'), r.result);
  assert.match(r.result, /confirme/i);
  assert.deepEqual((await deps.store.getCall('call_1')).offered, ['2026-10-23T12:00:00Z']);
});

test('a named time that is taken gets the nearest slots that day, and says so', async () => {
  const { deps } = setup();
  const r = first(await H.handleToolCall(tool('verifier_dispos', { jour: 'demain', heure: '11:00' }), deps));
  assert.match(r.result, /pas libre/);
  assert.ok(r.result.includes('option 1, demain, vendredi 23 octobre, à 9 heures 30'), r.result);
  assert.ok(r.result.includes('option 2'), r.result);
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
  assert.match(r.result, /Rendez-vous confirmé pour aujourd'hui, jeudi 22 octobre, à 14 heures/);
});

test('a slot taken between the offer and the booking is re-offered, not an error', async () => {
  const { cal, deps } = setup();
  await H.handleToolCall(tool('verifier_dispos', {}), deps);
  cal.takeExternally('2026-10-22T12:00:00Z');
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '1', nom: 'Jean Dupont', besoin: 'fuite' }, { id: 't2' }), deps));
  assert.equal(cal.booked.length, 0);
  assert.match(r.result, /vient d'être pris/);
  assert.ok(r.result.includes("option 1, aujourd'hui, jeudi 22 octobre, à 14 heures 30"), r.result);
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
  assert.equal(sent.sms.filter((s) => String(s.to).replace(/\D/g, '') === '33600000000').length, 1);
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

test('with a CRM set, the end of the call is forwarded once and recorded with the other deliveries', async () => {
  const { deps } = setup();
  const forwarded = [];
  deps.crm = async (payload) => { forwarded.push(payload); };
  await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  await H.handleCallReport(endOfCall(), deps); // redelivered by Vapi
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].callId, 'call_1');
  assert.equal(forwarded[0].status, 'rdv');
  assert.equal(forwarded[0].appointment.label, 'vendredi 23 octobre à 9 h 30');
  assert.equal(forwarded[0].caller.nom, 'Jean Dupont');
  assert.equal((await deps.store.getCall('call_1')).deliveries.crm.status, 'sent');
});

test('a CRM that refuses the call leaves a failed delivery for the daily check; the recap still goes', async () => {
  const { sent, deps } = setup();
  deps.crm = async () => { throw new Error('CRM 401: unauthorized'); };
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  assert.equal(sent.email.length, 1);
  const { crm } = (await deps.store.getCall('call_1')).deliveries;
  assert.equal(crm.status, 'failed');
  assert.equal(crm.reason, 'CRM 401: unauthorized');
});

test('without a CRM, nothing is forwarded and the deliveries have no CRM entry', async () => {
  const { deps } = setup();
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  assert.equal('crm' in (await deps.store.getCall('call_1')).deliveries, false);
});

test('handleVapiMessage routes each Vapi message type', async () => {
  const { deps } = setup();
  const tools = await H.handleVapiMessage(tool('verifier_dispos', {}), deps);
  assert.ok(Array.isArray(tools.results));
  const report = await H.handleVapiMessage(endOfCall(), deps);
  assert.equal(report.ok, true);
  assert.deepEqual(await H.handleVapiMessage({ type: 'status-update' }, deps), { ignored: true });
});

// Deliveries are recorded on the call (2026-10-23): a refused SMS used to leave only a log line,
// a landline caller was promised an SMS, and a recap that reached nobody was marked as sent.
const BOOK = { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'fuite' };
const refused = (label) => async () => { throw new Error(`${label} 401: unrecognised IP address 104.28.0.1`); };

test('a caller on a landline is not promised an SMS, and the call says why', async () => {
  const { sent, deps } = setup();
  const landline = { id: 'call_fixe', type: 'inboundPhoneCall', customer: { number: '+33556123456' } };
  const r = first(await H.handleToolCall(tool('prendre_rdv', BOOK, { call: landline }), deps));
  assert.equal(sent.sms.length, 0);
  assert.doesNotMatch(r.result, /SMS/);
  const d = (await deps.store.getCall('call_fixe')).deliveries.callerSms;
  assert.equal(d.status, 'skipped');
  assert.match(d.reason, /fixe/);
});

test('a sent caller SMS is recorded on the call', async () => {
  const { deps } = setup();
  await H.handleToolCall(tool('prendre_rdv', BOOK), deps);
  const d = (await deps.store.getCall('call_1')).deliveries.callerSms;
  assert.equal(d.status, 'sent');
  assert.equal(d.to, '+33612345678');
});

test('a refused caller SMS is recorded with its reason, and the agent does not promise it', async () => {
  const { deps } = setup();
  deps.notify.sms = refused('brevo sms');
  const r = first(await H.handleToolCall(tool('prendre_rdv', BOOK), deps));
  assert.doesNotMatch(r.result, /SMS/);
  const d = (await deps.store.getCall('call_1')).deliveries.callerSms;
  assert.equal(d.status, 'failed');
  assert.match(d.reason, /401/);
});

test('each recap channel is recorded on the call, failures included', async () => {
  const { deps } = setup();
  deps.notify.sms = refused('brevo sms');
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  const { recap } = (await deps.store.getCall('call_1')).deliveries;
  assert.equal(recap.email.status, 'sent');
  assert.equal(recap.sms.length, 1);
  assert.equal(recap.sms[0].status, 'failed');
  assert.equal(recap.sms[0].to, '+33600000000');
  assert.match(recap.sms[0].reason, /401/);
});

test('a recap that reached nobody is not marked as sent, so a redelivered report tries again', async () => {
  const { sent, deps } = setup();
  let down = true;
  deps.notify.email = async (m) => { if (down) throw new Error('resend 500'); sent.email.push(m); };
  deps.notify.sms = async (m) => { if (down) throw new Error('brevo sms 401'); sent.sms.push(m); };
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  assert.equal((await deps.store.getCall('call_1')).recapSentAt ?? null, null);
  down = false;
  await H.handleCallReport(endOfCall(), deps);
  assert.equal(sent.email.length, 1);
  assert.ok((await deps.store.getCall('call_1')).recapSentAt);
});

test('without an email provider the recap email is recorded as failed, not skipped in silence', async () => {
  const { deps } = setup();
  delete deps.notify.email;
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'devis' }), deps);
  await H.handleCallReport(endOfCall(), deps);
  const { recap } = (await deps.store.getCall('call_1')).deliveries;
  assert.equal(recap.email.status, 'failed');
  assert.match(recap.email.reason, /email/);
});

// Business information (2026-10-24): the service area is enforced by the webhook, not left to the prompt.
const AREA = { infos: { zone: ['Bordeaux', 'Mérignac'], tarifsUrl: 'https://plomberie-dupont.example/tarifs' } };

test('a request from a town outside the area is noted, and the agent is told to say so', async () => {
  const { deps } = setup({ config: AREA });
  const r = first(await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'fuite', ville: 'Arcachon' }), deps));
  assert.match(r.result, /n'intervient pas/);
  assert.equal((await deps.store.getCall('call_1')).caller.ville, 'Arcachon');
});

test('no slot is offered for a town outside the area', async () => {
  const { deps } = setup({ config: AREA });
  const r = first(await H.handleToolCall(tool('verifier_dispos', { ville: 'Arcachon' }), deps));
  assert.match(r.result, /n'intervient pas/);
  assert.doesNotMatch(r.result, /option 1/);
});

test('slots are offered for a town in the area, written any way', async () => {
  const { deps } = setup({ config: AREA });
  const r = first(await H.handleToolCall(tool('verifier_dispos', { ville: 'merignac' }), deps));
  assert.match(r.result, /option 1/);
});

test('with an area set, no booking happens before the town is known', async () => {
  const { cal, deps } = setup({ config: AREA });
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'fuite' }), deps));
  assert.equal(cal.booked.length, 0);
  assert.match(r.result, /ville/);
});

test('a booking for a town outside the area is refused', async () => {
  const { cal, deps } = setup({ config: AREA });
  const r = first(await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z', nom: 'Jean Dupont', besoin: 'fuite', ville: 'Arcachon' }), deps));
  assert.equal(cal.booked.length, 0);
  assert.match(r.result, /n'intervient pas/);
});

test('a booking in the area carries the address to the calendar and the rates link to the caller', async () => {
  const { cal, sent, deps } = setup({ config: AREA });
  await H.handleToolCall(tool('noter_demande', { nom: 'Jean Dupont', besoin: 'fuite sous évier', ville: 'Mérignac', adresse: '12 rue des Lilas' }), deps);
  await H.handleToolCall(tool('prendre_rdv', { creneau: '2026-10-23T07:30:00Z' }, { id: 't2' }), deps);
  assert.equal(cal.booked.length, 1);
  assert.match(cal.booked[0].notes, /12 rue des Lilas, Mérignac/);
  assert.ok(callerSms(sent)[0].content.includes('https://plomberie-dupont.example/tarifs'));
  await H.handleCallReport(endOfCall(), deps);
  assert.match(sent.email[0].text, /Adresse : 12 rue des Lilas, Mérignac/);
});

// Transfer to the business (2026-10-25). NOW is a Thursday, 9 h in Paris.
const TRANSFER = { transfert: { numero: '06 00 00 00 02', horaires: 'lun-ven 8h-18h' } };

test('an emergency within the transfer hours is put through to the business', async () => {
  const { deps } = setup({ config: TRANSFER });
  const out = await H.handleToolCall(tool('demander_transfert', { motif: 'urgence' }), deps);
  assert.match(first(out).result, /appelle transferCall/);
  assert.match(first(out).result, /Si personne ne répond/);
});

test('a caller asking for a person is put through too', async () => {
  const { deps } = setup({ config: TRANSFER });
  const out = await H.handleToolCall(tool('demander_transfert', { motif: 'demande_appelant' }), deps);
  assert.match(first(out).result, /appelle transferCall/);
});

test('outside the transfer hours, the emergency is noted for a call-back instead', async () => {
  const { deps } = setup({ config: { transfert: { numero: '06 00 00 00 02', horaires: 'sam 9h-12h' } } });
  const out = await H.handleToolCall(tool('demander_transfert', { motif: 'urgence' }), deps);
  assert.doesNotMatch(first(out).result, /appelle transferCall/);
  assert.match(first(out).result, /noter_demande/);
  assert.match(first(out).result, /urgence immédiate/);
});

test('any other reason gets no transfer', async () => {
  const { deps } = setup({ config: TRANSFER });
  const out = await H.handleToolCall(tool('demander_transfert', { motif: 'devis' }), deps);
  assert.doesNotMatch(first(out).result, /appelle transferCall/);
  assert.match(first(out).result, /réservé aux urgences/);
});
