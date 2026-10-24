// When a call may be put through to the business: only for an emergency or a caller who asks for a
// person, and only within the transfer hours, read in the business's time zone. No hours: any hour.
// Pure; the webhook asks before the agent transfers, so the rule holds even if the model forgets it.

const DAYS = { lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7 };
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const REASONS = new Set(['urgence', 'demande_appelant']);
const FORM = 'write them like "lun-ven 8h-18h; sam 9h-12h30"';
const DAY = '(lun|mar|mer|jeu|ven|sam|dim)';
const TIME = '(\\d{1,2})(?:h(\\d{2})?|:(\\d{2}))';
const SEGMENT = new RegExp(`^${DAY}(?:-${DAY})?\\s+${TIME}-${TIME}$`);

const minutes = (h, m) => (Number(h) <= 24 && Number(m ?? 0) < 60 ? Number(h) * 60 + Number(m ?? 0) : null);

/** "lun-ven 8h-18h; sam 9h-12h30" as windows: ISO days (1 = Monday) and minutes from midnight, end excluded. */
export function parseTransferHours(text) {
  const windows = [];
  for (const raw of String(text ?? '').toLowerCase().split(/[;,]/).map((s) => s.trim()).filter(Boolean)) {
    const m = raw.match(SEGMENT);
    const first = m && DAYS[m[1]];
    const last = m && (m[2] ? DAYS[m[2]] : first);
    const from = m && minutes(m[3], m[4] ?? m[5]);
    const to = m && minutes(m[6], m[7] ?? m[8]);
    if (!m || last < first || from === null || to === null || to > 1440 || from >= to) {
      return { error: `"${raw}" cannot be read: ${FORM}` };
    }
    windows.push({ days: Array.from({ length: last - first + 1 }, (_, i) => first + i), from, to });
  }
  return { windows };
}

function localTime(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: WEEKDAYS[parts.weekday], minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** @returns {{allowed: true} | {allowed: false, why: 'reason' | 'bad-hours' | 'outside-hours'}} */
export function transferDecision({ reason, now, hours, timeZone = 'Europe/Paris' }) {
  if (!REASONS.has(reason)) return { allowed: false, why: 'reason' };
  if (!String(hours ?? '').trim()) return { allowed: true };
  const parsed = parseTransferHours(hours);
  if (parsed.error) return { allowed: false, why: 'bad-hours' };
  const { day, minute } = localTime(now, timeZone);
  const open = parsed.windows.some((w) => w.days.includes(day) && minute >= w.from && minute < w.to);
  return open ? { allowed: true } : { allowed: false, why: 'outside-hours' };
}
