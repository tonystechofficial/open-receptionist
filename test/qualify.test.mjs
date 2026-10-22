import test from 'node:test';
import assert from 'node:assert/strict';
import { qualify, mergeCaller } from '../src/core/qualify.mjs';

test('maps urgent wording to immediate', () => {
  const r = qualify({ nom: 'Jean', besoin: "j'ai une fuite d'eau", urgence: 'il faut venir tout de suite', telephone: '0612345678' });
  assert.equal(r.urgence, 'immediate');
});

test('maps this-week wording to haute', () => {
  const r = qualify({ nom: 'Jean', besoin: 'un devis', urgence: 'si possible cette semaine', telephone: '0612345678' });
  assert.equal(r.urgence, 'haute');
});

test('defaults urgence to normale when nothing signals urgency', () => {
  const r = qualify({ nom: 'Jean', besoin: 'un devis pour une rénovation', telephone: '0612345678' });
  assert.equal(r.urgence, 'normale');
});

test('normalizes a French mobile number to E.164', () => {
  const r = qualify({ nom: 'Jean', besoin: 'devis', telephone: '06 12 34 56 78' });
  assert.equal(r.telephone, '+33612345678');
});

test('lowercases and keeps a valid email', () => {
  const r = qualify({ nom: 'Jean', besoin: 'devis', email: 'Jean.Dupont@MAIL.fr', telephone: '0612345678' });
  assert.equal(r.email, 'jean.dupont@mail.fr');
});

test('flags an incomplete call with no reachable contact', () => {
  const r = qualify({ nom: 'Jean', besoin: 'devis' });
  assert.equal(r.complet, false);
  assert.ok(r.manquants.includes('contact'));
});

test('a call with name, need and one contact is complete', () => {
  const r = qualify({ nom: 'Jean', besoin: 'fuite', telephone: '0612345678' });
  assert.equal(r.complet, true);
  assert.deepEqual(r.manquants, []);
});

test('honours an explicit urgency level given by the agent', () => {
  const r = qualify({ nom: 'Jean', besoin: 'un devis', urgence: 'haute', telephone: '0612345678' });
  assert.equal(r.urgence, 'haute');
});

test('the description can raise the urgency above the level the agent gave', () => {
  const r = qualify({ nom: 'Jean', besoin: "fuite d'eau", urgence: 'normale', telephone: '0612345678' });
  assert.equal(r.urgence, 'immediate');
});

test('mergeCaller keeps what an earlier step learned when a later step omits it', () => {
  const earlier = qualify({ nom: 'Jean Dupont', besoin: 'fuite', urgence: 'immediate', email: 'jean@x.fr', telephone: '0612345678' });
  const later = qualify({ nom: 'Jean Dupont', besoin: 'rappelez-moi pour le devis', urgence: 'normale' });
  const m = mergeCaller(earlier, later);
  assert.equal(m.email, 'jean@x.fr');
  assert.equal(m.telephone, '+33612345678');
  assert.equal(m.besoin, 'rappelez-moi pour le devis');
  assert.equal(m.urgence, 'immediate'); // once urgent, the call stays urgent
  assert.equal(m.complet, true);
});

test('mergeCaller tolerates a missing side', () => {
  const only = qualify({ nom: 'Jean', besoin: 'devis', telephone: '0612345678' });
  assert.equal(mergeCaller(null, only).nom, 'Jean');
  assert.equal(mergeCaller(only, null).nom, 'Jean');
});
