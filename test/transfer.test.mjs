// When a call may be put through to the business: the reason, and the transfer hours in Paris time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferHours, transferDecision } from '../src/core/transfer.mjs';

const decide = (now, hours, reason = 'urgence') => transferDecision({ reason, now: new Date(now), hours });

test('hours are read in words: a day or a range of days, hours with or without minutes', () => {
  assert.deepEqual(parseTransferHours('lun-ven 8h-18h; sam 9h-12h30'), {
    windows: [
      { days: [1, 2, 3, 4, 5], from: 480, to: 1080 },
      { days: [6], from: 540, to: 750 },
    ],
  });
  assert.deepEqual(parseTransferHours('Lun-Ven 08:00-18:00'), parseTransferHours('lun-ven 8h-18h'));
  assert.deepEqual(parseTransferHours('dim 10h-12h').windows[0].days, [7]);
});

test('hours that cannot be read are refused, with the expected form', () => {
  for (const bad of ['tous les jours', 'lun-ven', 'ven-lun 8h-18h', 'lun 18h-8h', 'lun 25h-26h']) {
    assert.match(parseTransferHours(bad).error, /lun-ven 8h-18h/, bad);
  }
});

test('within the hours, in Paris time, an emergency or a caller asking for a person is put through', () => {
  assert.deepEqual(decide('2026-10-22T07:00:00Z', 'lun-ven 8h-18h'), { allowed: true }); // jeudi 9 h
  assert.deepEqual(decide('2026-10-22T07:00:00Z', 'lun-ven 8h-18h', 'demande_appelant'), { allowed: true });
});

test('outside the hours, or on another day, the transfer is refused', () => {
  assert.equal(decide('2026-10-22T16:00:00Z', 'lun-ven 8h-18h').why, 'outside-hours'); // jeudi 18 h : la fin est exclue
  assert.equal(decide('2026-10-22T05:59:00Z', 'lun-ven 8h-18h').why, 'outside-hours'); // jeudi 7 h 59
  assert.equal(decide('2026-10-24T08:00:00Z', 'lun-ven 8h-18h').why, 'outside-hours'); // samedi 10 h
  assert.deepEqual(decide('2026-10-24T08:00:00Z', 'lun-ven 8h-18h; sam 9h-12h30'), { allowed: true });
});

test('Paris time follows the clock change', () => {
  // After the change of 25 October 2026 Paris is UTC+1: 7 h 30 UTC is 8 h 30, 6 h 30 UTC is 7 h 30.
  assert.deepEqual(decide('2026-10-26T07:30:00Z', 'lun-ven 8h-18h'), { allowed: true });
  assert.equal(decide('2026-10-26T06:30:00Z', 'lun-ven 8h-18h').why, 'outside-hours');
  // Before it, UTC+2: 6 h 30 UTC is 8 h 30.
  assert.deepEqual(decide('2026-10-23T06:30:00Z', 'lun-ven 8h-18h'), { allowed: true });
});

test('without hours, the transfer is allowed at any hour', () => {
  assert.deepEqual(decide('2026-10-25T01:00:00Z', ''), { allowed: true });
  assert.deepEqual(decide('2026-10-25T01:00:00Z', undefined), { allowed: true });
});

test('only an emergency or a caller asking for a person is put through', () => {
  assert.equal(decide('2026-10-22T07:00:00Z', 'lun-ven 8h-18h', 'devis').why, 'reason');
  assert.equal(decide('2026-10-22T07:00:00Z', 'lun-ven 8h-18h', null).why, 'reason');
});

test('unreadable hours refuse the transfer rather than guess', () => {
  assert.equal(decide('2026-10-22T07:00:00Z', 'tous les jours').why, 'bad-hours');
});
