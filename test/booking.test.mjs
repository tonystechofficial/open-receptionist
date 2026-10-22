import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSlot } from '../src/core/booking.mjs';

const now = new Date('2026-10-22T09:00:00Z');
const slots = [
  '2026-10-22T10:00:00Z',
  '2026-10-22T14:00:00Z',
  '2026-10-24T09:00:00Z',
];

test('returns null when no slot is free', () => {
  assert.equal(chooseSlot([], 'normale', now), null);
});

test('picks the earliest free slot for a normal request', () => {
  const r = chooseSlot(slots, 'normale', now);
  assert.equal(r.slot, '2026-10-22T10:00:00Z');
  assert.equal(r.within, true);
});

test('an immediate request within four hours is in-window', () => {
  const r = chooseSlot(slots, 'immediate', now);
  assert.equal(r.slot, '2026-10-22T10:00:00Z');
  assert.equal(r.within, true);
});

test('an immediate request with only far slots is flagged out-of-window', () => {
  const r = chooseSlot(['2026-10-24T09:00:00Z'], 'immediate', now);
  assert.equal(r.slot, '2026-10-24T09:00:00Z');
  assert.equal(r.within, false);
});

test('ignores slots in the past', () => {
  const r = chooseSlot(['2026-10-22T08:00:00Z', '2026-10-22T10:00:00Z'], 'normale', now);
  assert.equal(r.slot, '2026-10-22T10:00:00Z');
});
