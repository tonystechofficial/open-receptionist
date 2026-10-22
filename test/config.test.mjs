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
  assert.equal(r.config.maxDurationSeconds, 180);
  assert.ok(r.config.voice);
});

test('keeps an explicit voice override', () => {
  const r = validateClientConfig({ ...base, voice: { provider: '11labs', voiceId: 'xyz' } });
  assert.equal(r.config.voice.provider, '11labs');
});
