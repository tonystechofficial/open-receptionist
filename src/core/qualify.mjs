// Pure qualification of what a caller said. No DB, no network: testable in isolation.

const IMMEDIATE = [
  'fuite', 'inond', 'urgent', 'tout de suite', 'immédiat', 'immediat', 'maintenant',
  'dégât', 'degat', 'panne', "plus d'eau", 'déborde', 'deborde', 'danger', 'gaz',
];
const HAUTE = [
  'cette semaine', 'demain', 'rapide', 'bientôt', 'bientot', 'dès que', 'des que', 'au plus vite',
];

/** @param {string} s */
function level(s) {
  const t = (s || '').toLowerCase();
  if (IMMEDIATE.some((k) => t.includes(k))) return 'immediate';
  if (HAUTE.some((k) => t.includes(k))) return 'haute';
  return 'normale';
}

/** Normalize a phone number to a loose E.164. Returns null if clearly not a number. */
function normPhone(p) {
  if (!p) return null;
  const d = String(p).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.startsWith('0') && d.length === 10) return '+33' + d.slice(1); // FR mobile/landline
  if (d.length >= 11) return '+' + d;
  return null;
}

function normEmail(e) {
  if (!e) return null;
  const t = String(e).trim().toLowerCase().replace(/\s+/g, '');
  return t.includes('@') && t.lastIndexOf('.') > t.indexOf('@') ? t : null;
}

/**
 * @param {{nom?:string, besoin?:string, urgence?:string, telephone?:string, email?:string}} raw
 * @returns {{nom:string, besoin:string, urgence:'immediate'|'haute'|'normale', telephone:string|null, email:string|null, complet:boolean, manquants:string[]}}
 */
export function qualify(raw = {}) {
  const nom = (raw.nom || '').trim();
  const besoin = (raw.besoin || '').trim();
  const telephone = normPhone(raw.telephone);
  const email = normEmail(raw.email);
  // Urgency can be stated in the dedicated field or slip into the description of the need.
  const urgence = level([raw.urgence, raw.besoin].filter(Boolean).join(' '));

  const manquants = [];
  if (!nom) manquants.push('nom');
  if (!besoin) manquants.push('besoin');
  if (!telephone && !email) manquants.push('contact');

  return { nom, besoin, urgence, telephone, email, complet: manquants.length === 0, manquants };
}
