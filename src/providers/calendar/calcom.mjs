// Cal.com calendar adapter (API v2). Verify the shape against https://cal.com/docs/api-reference
// before production — Cal.com's v2 fields move. No SDK, just fetch.

const BASE = 'https://api.cal.com/v2';

export function calcom({ apiKey, eventTypeId, apiVersion = '2024-08-13' }) {
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'cal-api-version': apiVersion };

  return {
    /** @returns {Promise<string[]>} ISO datetimes that are free */
    async getAvailableSlots({ from, to }) {
      const u = new URL(BASE + '/slots');
      u.searchParams.set('eventTypeId', String(eventTypeId));
      u.searchParams.set('start', from);
      u.searchParams.set('end', to);
      const res = await fetch(u, { headers });
      if (!res.ok) throw new Error(`cal.com slots ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const byDay = data.data ?? data.slots ?? {};
      const out = [];
      for (const day of Object.values(byDay)) {
        for (const s of day) out.push(typeof s === 'string' ? s : s.start ?? s.time);
      }
      return out.filter(Boolean);
    },

    async createBooking({ start, name, email, phone, notes, timeZone = 'Europe/Paris', lengthInMinutes }) {
      const body = {
        start,
        eventTypeId: Number(eventTypeId),
        attendee: { name, email: email || undefined, phoneNumber: phone || undefined, timeZone, language: 'fr' },
        metadata: { source: 'open-receptionist' },
        ...(notes ? { bookingFieldsResponses: { notes } } : {}),
        ...(lengthInMinutes ? { lengthInMinutes } : {}),
      };
      const res = await fetch(BASE + '/bookings', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`cal.com booking ${res.status}: ${await res.text()}`);
      return res.json();
    },
  };
}
