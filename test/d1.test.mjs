// Runs the real D1 migration and the D1 store's SQL on real SQLite (node:sqlite), through a thin
// wrapper shaped like a D1 binding. D1 is SQLite, so this catches SQL mistakes before a deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { d1Store } from '../src/db/d1.mjs';
import * as H from '../src/server/handlers.mjs';
import { validateClientConfig } from '../src/core/config.mjs';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}
const skip = DatabaseSync ? false : 'node:sqlite is not available in this Node version';

async function d1Binding() {
  const db = new DatabaseSync(':memory:');
  // Every migration, in order, as `wrangler d1 migrations apply` does.
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(await readFile(new URL(file, dir), 'utf8'));
  }
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      let args = [];
      const api = {
        bind(...values) { args = values; return api; },
        async run() {
          const r = stmt.run(...args);
          return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { success: true, results: stmt.all(...args) }; },
      };
      return api;
    },
  };
}

test('upsertCall creates then merges a call, and keeps the offered slots', { skip }, async () => {
  const store = d1Store(await d1Binding());
  await store.upsertCall('c1', { offered: ['2026-10-22T12:00:00Z', '2026-10-23T07:30:00Z'] });
  await store.upsertCall('c1', {
    caller: { nom: 'Jean', besoin: 'fuite', urgence: 'immediate', telephone: '+33612345678', email: null, complet: true },
    status: 'a_rappeler',
  });
  const c = await store.getCall('c1');
  assert.deepEqual(c.offered, ['2026-10-22T12:00:00Z', '2026-10-23T07:30:00Z']);
  assert.equal(c.caller.nom, 'Jean');
  assert.equal(c.caller.telephone, '+33612345678');
  assert.equal(c.status, 'a_rappeler');
  assert.equal((await store.all()).calls.length, 1);
});

test('a call with only offered slots has no caller yet', { skip }, async () => {
  const store = d1Store(await d1Binding());
  await store.upsertCall('c2', { offered: ['2026-10-22T12:00:00Z'] });
  assert.equal((await store.getCall('c2')).caller, null);
  assert.equal(await store.getCall('absent'), null);
});

test('appointments are found by call id', { skip }, async () => {
  const store = d1Store(await d1Binding());
  assert.equal(await store.findAppointmentByCallId('c1'), null);
  await store.saveAppointment({
    callId: 'c1', at: '2026-10-23T07:30:00.000Z', label: 'vendredi 23 octobre à 9 h 30',
    caller: { nom: 'Jean', telephone: '+33612345678' }, bookingRef: 'bk_1', createdAt: '2026-10-22T07:00:00.000Z',
  });
  const a = await store.findAppointmentByCallId('c1');
  assert.equal(a.label, 'vendredi 23 octobre à 9 h 30');
  assert.equal(a.bookingRef, 'bk_1');
});

test('a whole call runs on the D1 schema: offer, book, recap once', { skip }, async () => {
  let free = ['2026-10-22T12:00:00Z', '2026-10-23T07:30:00Z'];
  const booked = [];
  const calendar = {
    async getAvailableSlots() { return free.slice(); },
    async createBooking(b) {
      booked.push(b);
      free = free.filter((s) => +new Date(s) !== +new Date(b.start));
      return { data: { uid: 'bk_1' } };
    },
  };
  const sent = { email: [], sms: [] };
  const { config } = validateClientConfig({
    company: 'Plomberie Dupont', metier: 'plomberie', calendar: { provider: 'calcom', id: '1' },
    notify: { email: ['patron@dupont.fr'] },
  });
  const deps = {
    calendar, config, store: d1Store(await d1Binding()), now: () => new Date('2026-10-22T07:00:00Z'), log: () => {},
    notify: { email: async (m) => { sent.email.push(m); }, sms: async (m) => { sent.sms.push(m); } },
  };
  const call = { id: 'call_1', customer: { number: '+33612345678' } };
  const tool = (name, args, id) => ({ type: 'tool-calls', call, toolCallList: [{ id, function: { name, arguments: args } }] });

  await H.handleToolCall(tool('verifier_dispos', {}, 't1'), deps);
  await H.handleToolCall(tool('prendre_rdv', { creneau: '1', nom: 'Jean Dupont', besoin: 'fuite' }, 't2'), deps);
  await H.handleCallReport({ type: 'end-of-call-report', call }, deps);
  await H.handleCallReport({ type: 'end-of-call-report', call }, deps);

  assert.equal(booked.length, 1);
  assert.equal(sent.email.length, 1);
  assert.match(sent.email[0].text, /Rendez-vous : jeudi 22 octobre à 14 h/);
  const record = await deps.store.getCall('call_1');
  assert.equal(record.status, 'rdv');
  assert.ok(record.recapSentAt);
});

test('what was sent to whom is kept with the call', { skip }, async () => {
  const store = d1Store(await d1Binding());
  const deliveries = {
    callerSms: { status: 'failed', to: '+33612345678', reason: 'brevo sms 401', at: '2026-10-23T08:00:00.000Z' },
    recap: { email: { status: 'sent', at: '2026-10-23T08:05:00.000Z' }, sms: [] },
  };
  await store.upsertCall('c3', { deliveries });
  await store.upsertCall('c3', { status: 'rdv' });
  assert.deepEqual((await store.getCall('c3')).deliveries, deliveries);
  assert.equal((await store.getCall('c3')).status, 'rdv');
});

test('the daily check reads only the calls updated since a given instant', { skip }, async () => {
  const store = d1Store(await d1Binding());
  const before = new Date(Date.now() - 1000).toISOString();
  await store.upsertCall('c4', { status: 'a_rappeler' });
  assert.deepEqual((await store.callsUpdatedSince(before)).map((c) => c.callId), ['c4']);
  assert.deepEqual(await store.callsUpdatedSince(new Date(Date.now() + 60_000).toISOString()), []);
});

test('call attempts are counted per number, for withheld numbers and in total, allowed ones only', { skip }, async () => {
  const store = d1Store(await d1Binding());
  const now = new Date('2026-10-24T10:00:00Z');
  const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const me = '+33612345678';
  await store.recordAttempt({ number: me, at: at(10), decision: 'allowed', reason: null, via: 'twilio', providerCallId: 'CA1' });
  await store.recordAttempt({ number: me, at: at(120), decision: 'allowed', reason: null, via: 'twilio', providerCallId: 'CA2' });
  await store.recordAttempt({ number: me, at: at(5), decision: 'refused', reason: 'number-hour', via: 'twilio', providerCallId: 'CA3' });
  await store.recordAttempt({ number: null, at: at(20), decision: 'allowed', reason: null, via: 'vapi', providerCallId: 'c4' });
  await store.recordAttempt({ number: '+33700000000', at: at(30), decision: 'allowed', reason: null, via: 'vapi', providerCallId: 'c5' });
  assert.deepEqual(await store.attemptCounts({ number: me, now }), { numberHour: 1, numberDay: 2, anonymousHour: 1, totalHour: 3 });
  assert.deepEqual(await store.attemptCounts({ number: null, now }), { numberHour: 0, numberDay: 0, anonymousHour: 1, totalHour: 3 });
  const since = await store.attemptsSince(at(60));
  assert.deepEqual(since.map((a) => a.providerCallId), ['c5', 'c4', 'CA1', 'CA3']);
  assert.equal(since[3].reason, 'number-hour');
});
