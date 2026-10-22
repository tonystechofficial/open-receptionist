import test from 'node:test';
import assert from 'node:assert/strict';
import { qualify } from '../src/core/qualify.mjs';

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
