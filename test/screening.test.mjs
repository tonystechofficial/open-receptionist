// Screening an incoming call before the receptionist answers: who gets through, and what the others hear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { screenCall, screeningLimits, blockedNumbers, refusalMessage, DEFAULT_LIMITS } from '../src/core/screening.mjs';

const NONE = { numberHour: 0, numberDay: 0, anonymousHour: 0, totalHour: 0 };
const ME = '+33612345678';

test('a first call from a number goes through', () => {
  assert.deepEqual(screenCall({ number: ME, counts: NONE }), { allow: true });
});

test('a blocked number is refused, whatever the counts', () => {
  assert.deepEqual(screenCall({ number: ME, blocked: [ME], counts: NONE }), { allow: false, reason: 'blocked' });
});

test('a number that already got through 4 times this hour is refused', () => {
  assert.equal(screenCall({ number: ME, counts: { ...NONE, numberHour: 3, numberDay: 3, totalHour: 3 } }).allow, true);
  assert.deepEqual(screenCall({ number: ME, counts: { ...NONE, numberHour: 4, numberDay: 4, totalHour: 4 } }), { allow: false, reason: 'number-hour' });
});

test('a number that already got through 8 times today is refused', () => {
  assert.deepEqual(screenCall({ number: ME, counts: { ...NONE, numberHour: 1, numberDay: 8, totalHour: 1 } }), { allow: false, reason: 'number-day' });
});

test('withheld numbers share a small hourly allowance', () => {
  assert.equal(screenCall({ number: null, counts: { ...NONE, anonymousHour: 4, totalHour: 4 } }).allow, true);
  assert.deepEqual(screenCall({ number: null, counts: { ...NONE, anonymousHour: 5, totalHour: 5 } }), { allow: false, reason: 'anonymous' });
});

test('past 30 calls in the hour, every caller is refused: a flood from many numbers stays bounded', () => {
  assert.deepEqual(screenCall({ number: ME, counts: { ...NONE, totalHour: 30 } }), { allow: false, reason: 'total' });
  assert.deepEqual(screenCall({ number: null, counts: { ...NONE, totalHour: 30 } }), { allow: false, reason: 'total' });
});

test('limits come from the environment, and anything but a positive whole number keeps the default', () => {
  assert.deepEqual(screeningLimits({}), DEFAULT_LIMITS);
  const l = screeningLimits({ SCREEN_PER_NUMBER_HOUR: '2', SCREEN_PER_NUMBER_DAY: 'beaucoup', SCREEN_ANONYMOUS_HOUR: '0', SCREEN_TOTAL_HOUR: '50' });
  assert.deepEqual(l, { ...DEFAULT_LIMITS, perNumberHour: 2, totalHour: 50 });
});

test('the block list accepts numbers written any usual way', () => {
  assert.deepEqual(blockedNumbers('06 12 34 56 78, +33 7 12 34 56 78, pas un numéro'), ['+33612345678', '+33712345678']);
  assert.deepEqual(blockedNumbers(undefined), []);
});

test('a refused caller is always told how to reach help in an emergency', () => {
  for (const reason of ['blocked', 'number-hour', 'number-day', 'anonymous', 'total']) {
    const m = refusalMessage(reason, 'Plomberie Dupont');
    assert.match(m, /112/, reason);
  }
  assert.match(refusalMessage('number-hour', 'Plomberie Dupont'), /Plomberie Dupont/);
  assert.match(refusalMessage('anonymous', 'Plomberie Dupont'), /masqu/);
});
