// The business's service area: whether the town the caller gives is one it serves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTown, inZone } from '../src/core/zone.mjs';

const ZONE = ['Bordeaux', 'Mérignac', 'Saint-Médard-en-Jalles', "Villenave-d'Ornon"];

test('town names compare without accents, case, hyphens or apostrophes', () => {
  assert.equal(normalizeTown('  Saint-Médard-en-Jalles '), 'saint medard en jalles');
  assert.equal(normalizeTown("VILLENAVE D'ORNON"), 'villenave d ornon');
});

test('a town of the list is in the area, however the caller says it', () => {
  assert.equal(inZone('merignac', ZONE), true);
  assert.equal(inZone('Saint Médard en Jalles', ZONE), true);
  assert.equal(inZone("villenave d'ornon", ZONE), true);
});

test('a town outside the list is not', () => {
  assert.equal(inZone('Arcachon', ZONE), false);
});

test('without a configured area every town is served, and an unknown town is not judged', () => {
  assert.equal(inZone('Arcachon', []), true);
  assert.equal(inZone(undefined, ZONE), null);
  assert.equal(inZone('', ZONE), null);
});
