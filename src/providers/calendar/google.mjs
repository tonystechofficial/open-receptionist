// Google Calendar adapter — stub. Most real clients already live in Google Calendar.
// Implement with a service account (domain-wide delegation) or OAuth, then calendar.events.insert
// and freebusy.query. See https://developers.google.com/calendar/api.

export function google() {
  return {
    async getAvailableSlots() { throw new Error('Google Calendar adapter not implemented yet. See docs/PROVIDERS.md.'); },
    async createBooking() { throw new Error('Google Calendar adapter not implemented yet. See docs/PROVIDERS.md.'); },
  };
}
