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
 * Why an SMS must not go to this number, or null when it may. Only the listed countries (dialling
 * codes, France by default) get an SMS: a caller can dictate any number for the confirmation, and SMS
 * to some countries cost many times the French rate (SMS pumping fraud). Among French numbers only
 * mobiles (06, 07) receive SMS: landlines and internet-box lines (01 to 05, 09) and service numbers
 * (08) do not.
 */
export function smsRefusal(phone, countries = ['33']) {
  const n = normalizePhone(phone);
  if (!n) return 'numéro invalide';
  const country = countries.find((code) => n.startsWith(`+${code}`));
  if (!country) return 'pays non autorisé pour les SMS (SMS_COUNTRIES)';
  if (country === '33' && !/^\+33[67]\d{8}$/.test(n)) return 'numéro fixe ou spécial, qui ne reçoit pas de SMS';
  return null;
}

/** Whether an SMS can reach this number, from the countries listed. */
export function canReceiveSms(phone, countries) {
  return smsRefusal(phone, countries) === null;
}
