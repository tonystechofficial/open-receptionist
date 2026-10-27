import test from 'node:test';
import assert from 'node:assert/strict';
import { toGsm7, formatPhoneFr, confirmationSms, ownerRecap } from '../src/core/messages.mjs';

// GSM 03.38 basic alphabet: one SMS holds 160 of these; any other character cuts the capacity to 70.
const GSM7 = /^[@£$¥èéùìòÇØø\n\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-.\/0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà]*$/;

test('toGsm7 keeps the French accents the SMS alphabet has and replaces the others', () => {
  assert.equal(toGsm7('rendez-vous confirmé à 9 h'), 'rendez-vous confirmé à 9 h');
  assert.equal(toGsm7('août, être, garçon, cœur'), 'aout, etre, garcon, coeur');
  assert.equal(toGsm7('l’agence — bientôt…'), "l'agence - bientot...");
});

test('formatPhoneFr reads a French number in pairs', () => {
  assert.equal(formatPhoneFr('+33612345678'), '06 12 34 56 78');
  assert.equal(formatPhoneFr('0556123456'), '05 56 12 34 56');
  assert.equal(formatPhoneFr('+442071234567'), '+442071234567');
  assert.equal(formatPhoneFr(null), '');
});

test('confirmationSms fits one SMS in the GSM alphabet and carries the essentials', () => {
  const s = confirmationSms({ company: 'Plomberie Dupont', label: 'vendredi 23 octobre à 9 h 30', contactPhone: '+33556123456' });
  assert.ok(s.includes('Plomberie Dupont'));
  assert.ok(s.includes('vendredi 23 octobre à 9 h 30'));
  assert.ok(s.includes('05 56 12 34 56'));
  assert.ok(s.length <= 160, `length ${s.length}`);
  assert.match(s, GSM7);
});

test('confirmationSms leaves out the call-back sentence without a contact number', () => {
  const s = confirmationSms({ company: 'Plomberie Dupont', label: 'mardi 27 octobre à 14 h' });
  assert.ok(s.includes('mardi 27 octobre à 14 h'));
  assert.ok(!/appelez/i.test(s));
});

test('ownerRecap flags an emergency in the subject and the SMS', () => {
  const r = ownerRecap({
    company: 'Plomberie Dupont',
    caller: { nom: 'Jean Dupont', besoin: 'fuite sous évier', urgence: 'immediate', telephone: '+33612345678', email: null },
    appointment: null,
    summary: null,
  });
  assert.match(r.subject, /^\[URGENT\]/);
  assert.match(r.sms, /^URGENT/);
  assert.match(r.text, /à rappeler/);
  assert.match(r.text, /06 12 34 56 78/);
  assert.match(r.sms, GSM7);
  assert.equal(r.urgent, true);
});

test('ownerRecap states the booked slot for a normal call', () => {
  const r = ownerRecap({
    company: 'Plomberie Dupont',
    caller: { nom: 'Jean Dupont', besoin: 'devis', urgence: 'normale', telephone: '+33612345678', email: 'jean@x.fr' },
    appointment: { label: 'vendredi 23 octobre à 9 h 30' },
    summary: 'Demande de devis.',
  });
  assert.doesNotMatch(r.subject, /URGENT/);
  assert.match(r.text, /Rendez-vous : vendredi 23 octobre à 9 h 30/);
  assert.match(r.text, /Résumé : Demande de devis\./);
  assert.match(r.sms, /RDV vendredi 23 octobre à 9 h 30/);
});

test('with a published rates page, the confirmation carries its link, still in the SMS alphabet', () => {
  const s = confirmationSms({ company: 'Plomberie Dupont', label: 'vendredi 23 octobre à 9 h 30', contactPhone: '+33556123456', tarifsUrl: 'https://plomberie-dupont.example/tarifs' });
  assert.ok(s.includes('Tarifs : https://plomberie-dupont.example/tarifs'), s);
  assert.match(s, GSM7);
});

test('the owner recap gives the address and the town of the job', () => {
  const r = ownerRecap({ company: 'D', caller: { nom: 'Jean', besoin: 'fuite', urgence: 'normale', telephone: '+33612345678', ville: 'Mérignac', adresse: '12 rue des Lilas' } });
  assert.match(r.text, /Adresse : 12 rue des Lilas, Mérignac/);
  assert.match(r.sms, /Mérignac/);
});

test('the owner recap carries the discovery answers, when there are some', () => {
  const r = ownerRecap({ company: 'X', caller: { nom: 'A', qualification: { entreprise: 'Berger', activite: 'plombier', situation: 'messagerie', appels_manques: 8, echeance: 'janvier' } } });
  for (const s of ['Entreprise : Berger', 'Activité : plombier', 'Situation : messagerie', 'Appels manqués par semaine : 8', 'Échéance : janvier']) {
    assert.ok(r.text.includes(s), s);
  }
});

test('without discovery answers the recap is unchanged', () => {
  assert.doesNotMatch(ownerRecap({ company: 'X', caller: { nom: 'A' } }).text, /Entreprise|Échéance/);
});
