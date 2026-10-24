// Pure: whether the town the caller gives is in the business's service area. Callers say towns
// their own way ("Saint Médard", "merignac"), so names compare without case, accents, hyphens or
// apostrophes. No area configured means every town is served.

export function normalizeTown(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** true or false against the area; null when the town is unknown, so the caller must be asked. */
export function inZone(town, zone = []) {
  if (!zone.length) return true;
  const t = normalizeTown(town);
  if (!t) return null;
  return zone.some((z) => normalizeTown(z) === t);
}
