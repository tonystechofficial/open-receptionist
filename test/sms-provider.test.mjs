// Which SMS provider a deployment uses follows from the keys it was given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { smsProvider } from '../src/providers/notify/sms.mjs';

// A fake SID that is not shaped like a real one (AC + 32 hex), which GitHub's push protection blocks.
const TWILIO = { TWILIO_ACCOUNT_SID: 'AC_test_account', TWILIO_AUTH_TOKEN: 'tok' };

test('Twilio keys select Twilio', () => {
  const p = smsProvider(TWILIO);
  assert.equal(p.name, 'twilio');
  assert.equal(typeof p.adapter.sendSms, 'function');
  assert.equal(typeof p.adapter.check, 'function');
  assert.deepEqual(p.warnings, []);
});

test('a Brevo key alone selects Brevo', () => {
  assert.equal(smsProvider({ BREVO_API_KEY: 'k' }).name, 'brevo');
});

test('no key, no SMS provider', () => {
  const p = smsProvider({});
  assert.equal(p.name, null);
  assert.equal(p.adapter, null);
});

test('both providers set: Twilio sends, and a warning asks to remove the other key', () => {
  const p = smsProvider({ ...TWILIO, BREVO_API_KEY: 'k' });
  assert.equal(p.name, 'twilio');
  assert.ok(p.warnings.some((w) => w.includes('BREVO_API_KEY')), p.warnings.join('; '));
});

test('half a Twilio setup is not used, and says what is missing', () => {
  const p = smsProvider({ TWILIO_ACCOUNT_SID: TWILIO.TWILIO_ACCOUNT_SID });
  assert.equal(p.name, null);
  assert.ok(p.warnings.some((w) => w.includes('TWILIO_AUTH_TOKEN')), p.warnings.join('; '));
});
