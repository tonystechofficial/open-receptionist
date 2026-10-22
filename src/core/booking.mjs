// Pure slot selection. `now` is injected so the decision is deterministic and testable.

/** How soon a slot must be, per urgency level, in milliseconds. */
const WINDOW_MS = {
  immediate: 4 * 3600_000, // within 4 hours
  haute: 48 * 3600_000, // within 2 days
  normale: Infinity, // any future slot
};

/**
 * @param {string[]} slots ISO datetimes that are free
 * @param {'immediate'|'haute'|'normale'} urgence
 * @param {Date} [now]
 * @returns {{slot:string, within:boolean}|null}
 */
export function chooseSlot(slots, urgence, now = new Date()) {
  const t = now.getTime();
  const future = (slots || [])
    .map((s) => ({ s, ms: new Date(s).getTime() }))
    .filter((x) => Number.isFinite(x.ms) && x.ms >= t)
    .sort((a, b) => a.ms - b.ms);

  if (future.length === 0) return null;

  const earliest = future[0];
  const window = WINDOW_MS[urgence] ?? Infinity;
  const within = earliest.ms - t <= window;
  return { slot: earliest.s, within };
}
