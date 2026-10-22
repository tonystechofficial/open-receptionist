import test from 'node:test';
import assert from 'node:assert/strict';
import { calcom } from '../src/providers/calendar/calcom.mjs';

// A recording fake of fetch. It is also installed as the global fetch during each call,
// so no request can ever reach the real Cal.com from the test suite.
function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return responder(String(url), init);
  };
  fn.calls = calls;
  return fn;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function withGlobalFetch(fake, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = previous; }
}

test('slots use the version the slots endpoint requires and ask for Paris time', async () => {
  const f = fakeFetch(() => json({
    status: 'success',
    data: { '2026-10-23': [{ start: '2026-10-23T09:30:00.000+02:00' }, '2026-10-23T14:00:00.000+02:00'] },
  }));
  const slots = await withGlobalFetch(f, () =>
    calcom({ apiKey: 'k', eventTypeId: 7, fetch: f })
      .getAvailableSlots({ from: '2026-10-22T07:00:00.000Z', to: '2026-10-29T07:00:00.000Z', timeZone: 'Europe/Paris' }));
  assert.deepEqual(slots, ['2026-10-23T09:30:00.000+02:00', '2026-10-23T14:00:00.000+02:00']);
  const { url, init } = f.calls[0];
  assert.equal(init.headers['cal-api-version'], '2024-09-04');
  assert.match(url, /\/v2\/slots\?/);
  assert.match(url, /timeZone=Europe%2FParis/);
  assert.match(url, /eventTypeId=7/);
});

test('a booking uses the bookings version, a UTC start, and no email when none was given', async () => {
  const f = fakeFetch(() => json({ status: 'success', data: { uid: 'bk_1' } }, 201));
  const out = await withGlobalFetch(f, () =>
    calcom({ apiKey: 'k', eventTypeId: 7, fetch: f }).createBooking({
      start: '2026-10-23T09:30:00.000+02:00',
      name: 'Jean Dupont',
      phone: '+33612345678',
      notes: 'fuite',
      timeZone: 'Europe/Paris',
      metadata: { urgence: 'immediate' },
    }));
  assert.equal(out.data.uid, 'bk_1');
  const { init } = f.calls[0];
  assert.equal(init.headers['cal-api-version'], '2026-02-25');
  const body = JSON.parse(init.body);
  assert.equal(body.start, '2026-10-23T07:30:00.000Z');
  assert.equal(body.eventTypeId, 7);
  assert.equal(body.attendee.phoneNumber, '+33612345678');
  assert.ok(!('email' in body.attendee));
  assert.equal(body.attendee.timeZone, 'Europe/Paris');
  assert.equal(body.metadata.urgence, 'immediate');
});

test('a refused booking reports its HTTP status to the caller of the adapter', async () => {
  const f = fakeFetch(() => json({ status: 'error', error: { message: 'User either already has booking at this time or is not available' } }, 400));
  await assert.rejects(
    withGlobalFetch(f, () =>
      calcom({ apiKey: 'k', eventTypeId: 7, fetch: f }).createBooking({ start: '2026-10-23T07:30:00.000Z', name: 'Jean', timeZone: 'Europe/Paris' })),
    (e) => e.status === 400,
  );
});
