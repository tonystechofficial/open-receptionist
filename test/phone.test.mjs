import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, canReceiveSms } from '../src/core/phone.mjs';

test('French numbers in any usual spelling become E.164', () => {
  for (const raw of ['06 12 34 56 78', '0612345678', '06.12.34.56.78', '+33 6 12 34 56 78', '33612345678', '+33612345678']) {
    assert.equal(normalizePhone(raw), '+33612345678', raw);
  }
});

test('something that is not a phone number gives null', () => {
  for (const raw of ['', null, undefined, 'patron', '1234', '06 12']) assert.equal(normalizePhone(raw), null, String(raw));
});

test('among French numbers, only mobiles can receive an SMS', () => {
  assert.equal(canReceiveSms('+33612345678'), true);
  assert.equal(canReceiveSms('07 12 34 56 78'), true);
  assert.equal(canReceiveSms('+33556123456'), false); // Bordeaux landline
  assert.equal(canReceiveSms('+33912345678'), false); // 09: internet box line
  assert.equal(canReceiveSms('0 800 47 33 33'), false); // free number
});

test('a foreign number is given its chance', () => {
  assert.equal(canReceiveSms('+447700900123'), true);
});

test('no number, no SMS', () => {
  assert.equal(canReceiveSms(null), false);
  assert.equal(canReceiveSms('inconnu'), false);
});
