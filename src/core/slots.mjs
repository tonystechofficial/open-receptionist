// Pure slot logic: what to offer a caller, and how to say it in French.
// No network, no clock: `now` and the time zone are always passed in, so every decision is testable.
import { chooseSlot } from './booking.mjs';

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAY_MS = 86_400_000;

/** Calendar parts of an instant as seen on a wall clock in `timeZone`. */
function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

const dayIndex = (p) => Date.UTC(p.y, p.m - 1, p.d) / DAY_MS;
const isoDate = (p) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const fromDayIndex = (n) => {
  const t = new Date(n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

function speechTime(h, min) {
  const hour = h === 0 ? 'minuit' : h === 12 ? 'midi' : `${h} heure${h > 1 ? 's' : ''}`;
  return min ? `${hour} ${min}` : hour;
}

/**
 * French label for a slot.
 * style 'speech' (default) is meant to be read aloud: "aujourd'hui, jeudi 22 octobre, à 14 heures",
 * "demain, vendredi 23 octobre, à 9 heures 30". Today and tomorrow carry their weekday and date: said
 * just after midnight, "demain" alone is booked for a day the caller did not mean (first call, 27/10).
 * style 'written' is absolute, for an SMS read later: "vendredi 23 octobre à 9 h 30".
 */
export function formatSlotFr(iso, now = new Date(), { timeZone = 'Europe/Paris', style = 'speech' } = {}) {
  const at = localParts(new Date(iso), timeZone);
  const weekday = WEEKDAYS[new Date(Date.UTC(at.y, at.m - 1, at.d)).getUTCDay()];
  const date = `${weekday} ${at.d === 1 ? '1er' : at.d} ${MONTHS[at.m - 1]}`;
  if (style === 'written') {
    const time = at.min ? `${at.h} h ${String(at.min).padStart(2, '0')}` : `${at.h} h`;
    return `${date} à ${time}`;
  }
  const diff = dayIndex(at) - dayIndex(localParts(now, timeZone));
  const time = speechTime(at.h, at.min);
  if (diff === 0) return `aujourd'hui, ${date}, à ${time}`;
  if (diff === 1) return `demain, ${date}, à ${time}`;
  return `${date} à ${time}`;
}

const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/**
 * The calendar date ("YYYY-MM-DD", local to timeZone) a caller means by "demain", "lundi", etc.
 * A weekday counts from today included. Returns null when the words are not a day.
 */
export function resolvePreferredDay(jour, now = new Date(), timeZone = 'Europe/Paris') {
  if (!jour) return null;
  const raw = String(jour).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const today = localParts(now, timeZone);
  const offsets = { aujourdhui: 0, demain: 1, apresdemain: 2 };
  const key = normalize(raw);
  let offset = offsets[key];
  if (offset === undefined) {
    const wd = WEEKDAYS.map(normalize).indexOf(key);
    if (wd === -1) return null;
    const todayWd = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    offset = (wd - todayWd + 7) % 7;
  }
  return isoDate(fromDayIndex(dayIndex(today) + offset));
}

function momentRange(moment) {
  const key = normalize(moment);
  if (key === 'matin') return [0, 12];
  if (key === 'apresmidi' || key === 'aprem') return [12, 18];
  if (key === 'soir') return [18, 24];
  return null;
}

/** Keep the slots matching a caller's wish. A wish it cannot understand filters nothing. */
export function filterSlots(slots, { jour, moment } = {}, now = new Date(), timeZone = 'Europe/Paris') {
  const day = resolvePreferredDay(jour, now, timeZone);
  const range = momentRange(moment);
  return (slots || []).filter((s) => {
    const p = localParts(new Date(s), timeZone);
    if (day && isoDate(p) !== day) return false;
    if (range && !(p.h >= range[0] && p.h < range[1])) return false;
    return true;
  });
}

/** A time a caller names, as the agent passes it ("12:00", "14h30", "9 h", "midi"); null otherwise. */
export function parseHeure(heure) {
  const key = String(heure ?? '').trim().toLowerCase();
  if (key === 'midi') return { h: 12, min: 0 };
  if (key === 'minuit') return { h: 0, min: 0 };
  const m = key.match(/^(\d{1,2})\s*(?:h|:|heures?)\s*(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? { h, min } : null;
}

/**
 * The free slot at the exact time the caller named, on the day they named if any, earliest first.
 * Null when they named no time, or when that time is not free: the caller then hears the nearest ones.
 */
export function exactSlot(slots, { jour, heure } = {}, now = new Date(), timeZone = 'Europe/Paris') {
  const time = parseHeure(heure);
  if (!time) return null;
  const day = resolvePreferredDay(jour, now, timeZone);
  const matches = (slots || [])
    .map((s) => ({ s, ms: new Date(s).getTime(), p: localParts(new Date(s), timeZone) }))
    .filter((x) => Number.isFinite(x.ms) && x.ms >= now.getTime())
    .filter((x) => x.p.h === time.h && x.p.min === time.min && (!day || isoDate(x.p) === day))
    .sort((a, b) => a.ms - b.ms);
  return matches[0]?.s ?? null;
}

export function sameInstant(a, b) {
  const x = new Date(a).getTime();
  return Number.isFinite(x) && x === new Date(b).getTime();
}

export function withoutSlot(slots, iso) {
  return (slots || []).filter((s) => !sameInstant(s, iso));
}

/**
 * At most `max` slots to offer: the earliest (deciding whether the urgency is met), then slots
 * at least `minGapMs` apart so the caller gets a real choice, filled with the next ones if needed.
 */
export function offerSlots(slots, urgence, now = new Date(), { max = 2, minGapMs = 3 * 3_600_000 } = {}) {
  const t = now.getTime();
  const seen = new Set();
  const future = [];
  for (const s of slots || []) {
    const ms = new Date(s).getTime();
    if (!Number.isFinite(ms) || ms < t || seen.has(ms)) continue;
    seen.add(ms);
    future.push({ s, ms });
  }
  future.sort((a, b) => a.ms - b.ms);
  if (future.length === 0) return { options: [], within: false, none: true };

  const picked = [future[0]];
  for (const x of future.slice(1)) {
    if (picked.length >= max) break;
    if (x.ms - picked[picked.length - 1].ms >= minGapMs) picked.push(x);
  }
  for (const x of future.slice(1)) {
    if (picked.length >= max) break;
    if (!picked.includes(x)) picked.push(x);
  }
  picked.sort((a, b) => a.ms - b.ms);

  const { within } = chooseSlot(future.map((x) => x.s), urgence, now);
  return { options: picked.map((x) => x.s), within, none: false };
}
