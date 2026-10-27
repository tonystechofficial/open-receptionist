import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSlotFr, resolvePreferredDay, filterSlots, offerSlots, withoutSlot, sameInstant, parseHeure, exactSlot } from '../src/core/slots.mjs';

const NOW = new Date('2026-10-22T07:00:00Z'); // jeudi 22 octobre 2026, 9 h à Paris (heure d'été)
const TZ = 'Europe/Paris';

test("speech label: a slot later today reads aujourd'hui, with its weekday and date", () => {
  assert.equal(formatSlotFr('2026-10-22T12:00:00Z', NOW, { timeZone: TZ }), "aujourd'hui, jeudi 22 octobre, à 14 heures");
});

test('speech label: tomorrow, with its weekday and date, and minutes', () => {
  assert.equal(formatSlotFr('2026-10-23T07:30:00Z', NOW, { timeZone: TZ }), 'demain, vendredi 23 octobre, à 9 heures 30');
});

test('speech label: noon reads midi', () => {
  assert.equal(formatSlotFr('2026-10-23T10:00:00Z', NOW, { timeZone: TZ }), 'demain, vendredi 23 octobre, à midi');
});

test('speech label: after the October clock change Paris is UTC+1', () => {
  assert.equal(formatSlotFr('2026-10-27T13:00:00Z', NOW, { timeZone: TZ }), 'mardi 27 octobre à 14 heures');
});

test('speech label: first of the month reads 1er, one o clock reads 1 heure', () => {
  assert.equal(formatSlotFr('2026-11-01T00:00:00Z', NOW, { timeZone: TZ }), 'dimanche 1er novembre à 1 heure');
});

test('speech label: accepts the offset timestamps Cal.com returns', () => {
  assert.equal(formatSlotFr('2026-10-23T09:30:00.000+02:00', NOW, { timeZone: TZ }), 'demain, vendredi 23 octobre, à 9 heures 30');
});

test('written label for an SMS: absolute date, French typography', () => {
  assert.equal(formatSlotFr('2026-10-23T07:30:00Z', NOW, { timeZone: TZ, style: 'written' }), 'vendredi 23 octobre à 9 h 30');
  assert.equal(formatSlotFr('2026-10-22T12:00:00Z', NOW, { timeZone: TZ, style: 'written' }), 'jeudi 22 octobre à 14 h');
});

test('resolvePreferredDay understands relative words, weekdays and ISO dates', () => {
  assert.equal(resolvePreferredDay("aujourd'hui", NOW, TZ), '2026-10-22');
  assert.equal(resolvePreferredDay('demain', NOW, TZ), '2026-10-23');
  assert.equal(resolvePreferredDay('après-demain', NOW, TZ), '2026-10-24');
  assert.equal(resolvePreferredDay('Lundi', NOW, TZ), '2026-10-26');
  assert.equal(resolvePreferredDay('jeudi', NOW, TZ), '2026-10-22');
  assert.equal(resolvePreferredDay('2026-10-30', NOW, TZ), '2026-10-30');
  assert.equal(resolvePreferredDay('quand vous voulez', NOW, TZ), null);
});

const SLOTS = [
  '2026-10-22T12:00:00Z', // jeudi 14 h
  '2026-10-23T07:30:00Z', // vendredi 9 h 30
  '2026-10-23T12:00:00Z', // vendredi 14 h
  '2026-10-23T17:00:00Z', // vendredi 19 h
];

test('filterSlots keeps the preferred day', () => {
  assert.deepEqual(filterSlots(SLOTS, { jour: 'demain' }, NOW, TZ), ['2026-10-23T07:30:00Z', '2026-10-23T12:00:00Z', '2026-10-23T17:00:00Z']);
});

test('filterSlots keeps the preferred part of the day', () => {
  assert.deepEqual(filterSlots(SLOTS, { jour: 'demain', moment: 'matin' }, NOW, TZ), ['2026-10-23T07:30:00Z']);
  assert.deepEqual(filterSlots(SLOTS, { moment: 'après-midi' }, NOW, TZ), ['2026-10-22T12:00:00Z', '2026-10-23T12:00:00Z']);
  assert.deepEqual(filterSlots(SLOTS, { moment: 'soir' }, NOW, TZ), ['2026-10-23T17:00:00Z']);
});

test('filterSlots ignores wishes it does not understand', () => {
  assert.deepEqual(filterSlots(SLOTS, { jour: 'bientôt', moment: 'tôt' }, NOW, TZ), SLOTS);
});

// A named time (2026-10-27): the first real call asked for "demain à midi" and got two options again.
test('parseHeure reads the times a caller names', () => {
  assert.deepEqual(parseHeure('12:00'), { h: 12, min: 0 });
  assert.deepEqual(parseHeure('14h30'), { h: 14, min: 30 });
  assert.deepEqual(parseHeure('14 h 30'), { h: 14, min: 30 });
  assert.deepEqual(parseHeure('9h'), { h: 9, min: 0 });
  assert.deepEqual(parseHeure('midi'), { h: 12, min: 0 });
  assert.equal(parseHeure('dans la matinée'), null);
  assert.equal(parseHeure('25:00'), null);
  assert.equal(parseHeure(undefined), null);
});

test('exactSlot finds the free slot at the named time, on the named day', () => {
  assert.equal(exactSlot(SLOTS, { jour: 'demain', heure: '14:00' }, NOW, TZ), '2026-10-23T12:00:00Z');
  assert.equal(exactSlot(SLOTS, { heure: '14h' }, NOW, TZ), '2026-10-22T12:00:00Z');
  assert.equal(exactSlot(SLOTS, { jour: 'demain', heure: '11:00' }, NOW, TZ), null);
  assert.equal(exactSlot(SLOTS, { jour: 'demain' }, NOW, TZ), null);
  assert.equal(exactSlot(['2026-10-22T06:00:00Z'], { heure: '8h' }, NOW, TZ), null); // 8 h today is past
});

test('offerSlots proposes the earliest slot and one genuinely different alternative', () => {
  const r = offerSlots(['2026-10-22T12:00:00Z', '2026-10-22T12:30:00Z', '2026-10-22T13:00:00Z', '2026-10-23T07:30:00Z'], 'normale', NOW);
  assert.deepEqual(r.options, ['2026-10-22T12:00:00Z', '2026-10-23T07:30:00Z']);
  assert.equal(r.within, true);
  assert.equal(r.none, false);
});

test('offerSlots falls back to the next slot when none are far apart', () => {
  const r = offerSlots(['2026-10-22T12:00:00Z', '2026-10-22T12:30:00Z'], 'normale', NOW);
  assert.deepEqual(r.options, ['2026-10-22T12:00:00Z', '2026-10-22T12:30:00Z']);
});

test('offerSlots flags an emergency that no slot can meet in time', () => {
  const r = offerSlots(['2026-10-27T13:00:00Z'], 'immediate', NOW);
  assert.deepEqual(r.options, ['2026-10-27T13:00:00Z']);
  assert.equal(r.within, false);
});

test('offerSlots reports when nothing is free', () => {
  assert.deepEqual(offerSlots([], 'normale', NOW), { options: [], within: false, none: true });
});

test('offerSlots skips past slots and duplicates of the same instant', () => {
  const r = offerSlots(['2026-10-22T06:00:00Z', '2026-10-22T12:00:00Z', '2026-10-22T14:00:00.000+02:00'], 'normale', NOW);
  assert.deepEqual(r.options, ['2026-10-22T12:00:00Z']);
});

test('withoutSlot removes the same instant whatever its format', () => {
  assert.deepEqual(withoutSlot(['2026-10-22T14:00:00.000+02:00', '2026-10-23T07:30:00Z'], '2026-10-22T12:00:00Z'), ['2026-10-23T07:30:00Z']);
  assert.equal(sameInstant('2026-10-22T12:00:00Z', '2026-10-22T14:00:00+02:00'), true);
});
