// Cal.com calendar adapter (API v2). No SDK, just fetch.
//
// Each v2 endpoint pins its own `cal-api-version` header, and an unknown or missing value
// silently falls back to an older contract (checked against the docs on 2026-10-22):
//   slots    2024-09-04  https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type
//   bookings 2026-02-25  https://cal.com/docs/api-reference/v2/bookings/create-a-booking
// In the bookings version the attendee email is optional, so a caller who only gives a phone
// number can be booked. Both versions can be overridden if Cal.com moves them again.

const BASE = 'https://api.cal.com/v2';
export const CALCOM_SLOTS_VERSION = '2024-09-04';
export const CALCOM_BOOKINGS_VERSION = '2026-02-25';

export function calcom({
  apiKey,
  eventTypeId,
  slotsApiVersion = CALCOM_SLOTS_VERSION,
  bookingsApiVersion = CALCOM_BOOKINGS_VERSION,
  fetch: fetchImpl,
} = {}) {
  const doFetch = (...args) => (fetchImpl ?? globalThis.fetch)(...args);
  const headers = (version) => ({
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'cal-api-version': version,
  });

  return {
    /** @returns {Promise<string[]>} free slot start times as Cal.com returns them (local offset) */
    async getAvailableSlots({ from, to, timeZone = 'Europe/Paris' }) {
      const u = new URL(`${BASE}/slots`);
      u.searchParams.set('eventTypeId', String(eventTypeId));
      u.searchParams.set('start', from);
      u.searchParams.set('end', to);
      u.searchParams.set('timeZone', timeZone);
      const res = await doFetch(u, { headers: headers(slotsApiVersion) });
      if (!res.ok) throw httpError('cal.com slots', res.status, await res.text());
      const body = await res.json();
      const out = [];
      // { data: { "2026-10-23": [{ start }] } }. The schema also allows plain strings, so accept both.
      for (const day of Object.values(body.data ?? {})) {
        for (const s of Array.isArray(day) ? day : []) out.push(typeof s === 'string' ? s : s?.start);
      }
      return out.filter(Boolean);
    },

    /** `start` may carry any offset; Cal.com wants UTC. */
    async createBooking({ start, name, email, phone, notes, timeZone = 'Europe/Paris', metadata = {}, lengthInMinutes }) {
      const attendee = { name, timeZone, language: 'fr' };
      if (email) attendee.email = email;
      if (phone) attendee.phoneNumber = phone;
      const body = {
        start: new Date(start).toISOString(),
        eventTypeId: Number(eventTypeId),
        attendee,
        metadata: stringValues({ source: 'open-receptionist', ...metadata }),
      };
      if (notes) body.bookingFieldsResponses = { notes: String(notes).slice(0, 500) };
      if (lengthInMinutes) body.lengthInMinutes = lengthInMinutes;
      const res = await doFetch(`${BASE}/bookings`, {
        method: 'POST',
        headers: headers(bookingsApiVersion),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw httpError('cal.com booking', res.status, await res.text());
      return res.json();
    },
  };
}

function httpError(what, status, text) {
  const e = new Error(`${what} ${status}: ${String(text).slice(0, 300)}`);
  e.status = status;
  return e;
}

// Cal.com metadata: at most 50 keys, keys up to 40 characters, string values up to 500.
function stringValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 50)) {
    if (v === undefined || v === null) continue;
    out[k.slice(0, 40)] = String(v).slice(0, 500);
  }
  return out;
}
