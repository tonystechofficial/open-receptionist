// Automatic deletion of old records: how long they are kept, and where the cut falls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { retentionDays, retentionCutoff, DEFAULT_RETENTION_DAYS } from '../src/core/retention.mjs';

test('records are kept 12 months unless the business sets another period', () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 365);
  assert.deepEqual(retentionDays(undefined), { days: 365 });
  assert.deepEqual(retentionDays(''), { days: 365 });
  assert.deepEqual(retentionDays('90'), { days: 90 });
});

test('a period under 30 days or over 5 years is ignored with a warning, never applied', () => {
  for (const raw of ['10', '4000', 'un an', '1.5']) {
    const r = retentionDays(raw);
    assert.equal(r.days, 365, raw);
    assert.match(r.warning, /RETENTION_DAYS/, raw);
  }
});

test('the cut falls exactly the given number of days before now', () => {
  assert.equal(retentionCutoff(new Date('2026-10-24T06:00:00Z'), 365), '2025-10-24T06:00:00.000Z');
});
