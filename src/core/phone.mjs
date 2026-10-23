// Pure phone-number rules. No DB, no network: testable in isolation.

/** Normalize a phone number to a loose E.164. Returns null if clearly not a number. */
export function normalizePhone(p) {
  if (!p) return null;
  const d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.startsWith('0') && d.length === 10) return '+33' + d.slice(1); // FR mobile/landline
  if (d.length >= 11) return '+' + d;
  return null;
}

/**
 * Whether an SMS can reach this number. Among French numbers only mobiles (06, 07) receive SMS:
 * landlines and internet-box lines (01 to 05, 09) and service numbers (08) do not. A foreign number
 * gets its chance, since its numbering plan is not known here.
 */
export function canReceiveSms(phone) {
  const n = normalizePhone(phone);
  if (!n) return false;
  if (n.startsWith('+33')) return /^\+33[67]\d{8}$/.test(n);
  return true;
}
