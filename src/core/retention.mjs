// Pure: how long call records are kept before the daily run deletes them (GDPR asks for a stated
// period). 12 months by default; a business may choose from 30 days, enough to call customers back,
// to 5 years, the usual limit for claims between a business and its customers.
export const DEFAULT_RETENTION_DAYS = 365;
const MIN_DAYS = 30;
const MAX_DAYS = 1825;
const DAY_MS = 86_400_000;

/** RETENTION_DAYS from the environment. A value out of bounds is ignored with a warning, never applied. */
export function retentionDays(raw) {
  if (raw === undefined || raw === null || raw === '') return { days: DEFAULT_RETENTION_DAYS };
  const n = Number(raw);
  if (Number.isInteger(n) && n >= MIN_DAYS && n <= MAX_DAYS) return { days: n };
  return {
    days: DEFAULT_RETENTION_DAYS,
    warning: `RETENTION_DAYS "${raw}" ignored: a whole number of days from ${MIN_DAYS} to ${MAX_DAYS} is expected, ${DEFAULT_RETENTION_DAYS} applied`,
  };
}

/** The instant before which records are deleted. */
export function retentionCutoff(now, days) {
  return new Date(new Date(now).getTime() - days * DAY_MS).toISOString();
}
