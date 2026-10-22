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
