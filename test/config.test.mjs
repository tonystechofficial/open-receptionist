import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClientConfig } from '../src/core/config.mjs';

const base = {
  company: 'Plomberie Dupont',
  metier: 'plomberie',
  calendar: { provider: 'calcom', id: 'plomberie-dupont' },
  notify: { email: ['contact@plomberie-dupont.fr'] },
};

test('rejects a config without a company', () => {
  const r = validateClientConfig({ ...base, company: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('company')));
});

test('requires at least one notification channel', () => {
  const r = validateClientConfig({ ...base, notify: {} });
  assert.equal(r.ok, false);
});

test('accepts a valid config and applies defaults', () => {
  const r = validateClientConfig(base);
  assert.equal(r.ok, true);
  assert.equal(r.config.language, 'fr');
  assert.equal(r.config.recordingEnabled, false);
  // 5 minutes: qualifying, choosing a slot and confirming can run past 3 minutes.
  assert.equal(r.config.maxDurationSeconds, 300);
  assert.ok(r.config.voice);
});

test('keeps an explicit voice override', () => {
  const r = validateClientConfig({ ...base, voice: { provider: '11labs', voiceId: 'xyz' } });
  assert.equal(r.config.voice.provider, '11labs');
});

test('defaults the time zone to Paris and turns the caller SMS confirmation on', () => {
  const r = validateClientConfig(base);
  assert.equal(r.config.timeZone, 'Europe/Paris');
  assert.equal(r.config.confirmation.sms, true);
});

test('keeps the caller SMS confirmation off when asked', () => {
  const r = validateClientConfig({ ...base, confirmation: { sms: false } });
  assert.equal(r.config.confirmation.sms, false);
});

test('an undefined field does not erase a default', () => {
  const r = validateClientConfig({ ...base, timeZone: undefined, maxDurationSeconds: undefined });
  assert.equal(r.config.timeZone, 'Europe/Paris');
  assert.equal(r.config.maxDurationSeconds, 300);
});

test('rejects an SMS sender the operators would refuse', () => {
  const r = validateClientConfig({ ...base, smsSender: 'Plomberie Dupont Bordeaux' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('smsSender')));
});

test('accepts a short alphanumeric SMS sender', () => {
  assert.equal(validateClientConfig({ ...base, smsSender: 'Dupont' }).ok, true);
});

test('an SMS-only recap is refused: when the SMS fails, the owner never hears of the call', () => {
  const r = validateClientConfig({ ...base, notify: { sms: ['33612345678'] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('notify.email')), r.errors.join('; '));
});

test('owner SMS numbers are normalised, whatever their spelling', () => {
  const r = validateClientConfig({ ...base, notify: { ...base.notify, sms: ['06 12 34 56 78', '33712345678'] } });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.config.notify.sms, ['+33612345678', '+33712345678']);
});

test('an owner SMS number that is a landline or not a number is refused', () => {
  const r = validateClientConfig({ ...base, notify: { ...base.notify, sms: ['05 56 12 34 56', 'patron'] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('05 56 12 34 56')), r.errors.join('; '));
  assert.ok(r.errors.some((e) => e.includes('patron')), r.errors.join('; '));
});

test('a generic SMS sender is refused: carriers filter names like Info or Accueil', () => {
  for (const smsSender of ['Accueil', 'INFO', 'Support', 'SMS']) {
    const r = validateClientConfig({ ...base, smsSender });
    assert.equal(r.ok, false, smsSender);
    assert.ok(r.errors.some((e) => e.includes('smsSender')), smsSender);
  }
});

test('with an SMS provider, texting needs the business name as sender', () => {
  const providers = { email: true, sms: true };
  const r = validateClientConfig(base, { providers });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('smsSender')), r.errors.join('; '));
  assert.equal(validateClientConfig({ ...base, smsSender: 'Dupont' }, { providers }).ok, true);
});

test('with an SMS provider but no SMS to send, no sender is needed', () => {
  const r = validateClientConfig({ ...base, confirmation: { sms: false } }, { providers: { email: true, sms: true } });
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('owner SMS numbers without an SMS provider draw a warning, not an error', () => {
  const r = validateClientConfig({ ...base, notify: { ...base.notify, sms: ['33612345678'] } }, { providers: { email: true, sms: false } });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.ok(r.warnings.some((w) => w.includes('SMS')), r.warnings.join('; '));
});

test('without an email provider the recap cannot leave, and a warning says so', () => {
  const r = validateClientConfig(base, { providers: { email: false, sms: false } });
  assert.ok(r.warnings.some((w) => w.includes('email')), r.warnings.join('; '));
});

test('the example client config passes every rule, providers included', async () => {
  const { readFile } = await import('node:fs/promises');
  const example = JSON.parse(await readFile(new URL('../config/client.example.json', import.meta.url), 'utf8'));
  const r = validateClientConfig(example, { providers: { email: true, sms: true } });
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.warnings, []);
});

test('without knowing the providers, no provider rule applies', () => {
  const r = validateClientConfig(base);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.warnings, []);
});

test('an SMS sender made only of digits is refused: carriers read it as a phone number', () => {
  const r = validateClientConfig({ ...base, smsSender: '12345' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('smsSender')), r.errors.join('; '));
  assert.equal(validateClientConfig({ ...base, smsSender: 'Dupont33' }).ok, true);
});
