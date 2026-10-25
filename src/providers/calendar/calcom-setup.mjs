// The Cal.com event type `npm run cal:setup` creates for the receptionist. Pure: what is sent;
// scripts/cal-setup.mjs makes the calls. Checked against Cal.com's API v2 docs on 2026-10-25
// (POST /v2/event-types, cal-api-version 2026-06-12):
// https://cal.com/docs/api-reference/v2/event-types/create-an-event-type
//  - a caller who only gives a phone number is bookable only if the phone is required and the email
//    hidden and optional; the default notes field stays, it carries the need and the address;
//  - the place is a fixed address text: an attendee-defined place would make Cal.com refuse the
//    receptionist's bookings, which carry none.

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** One hour by default, 30 minutes for the road after, bookable from one hour ahead. */
export function eventTypeBody({ title = 'Intervention', minutes = 60, buffer = 30, notice = 60 } = {}) {
  return {
    title,
    slug: slugify(title),
    lengthInMinutes: minutes,
    afterEventBuffer: buffer,
    minimumBookingNotice: notice,
    description: "Pris par le réceptionniste vocal. Le besoin et l'adresse de l'intervention sont dans les notes.",
    locations: [{ type: 'address', address: "Chez le client, adresse dans les notes", public: true }],
    bookingFields: [
      { field: 'email', slug: 'email', required: false, hidden: true },
      { field: 'attendeePhoneNumber', slug: 'attendeePhoneNumber', required: true, hidden: false },
    ],
  };
}

export function findEventType(list, slug) {
  return (Array.isArray(list) ? list : []).find((e) => e?.slug === slug) ?? null;
}
