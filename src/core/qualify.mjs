// Pure qualification of what a caller said. No DB, no network: testable in isolation.
import { normalizePhone } from './phone.mjs';

const IMMEDIATE = [
  'fuite', 'inond', 'urgent', 'tout de suite', 'immédiat', 'immediat', 'maintenant',
  'dégât', 'degat', 'panne', "plus d'eau", 'déborde', 'deborde', 'danger', 'gaz',
];
const LEVELS = ['normale', 'haute', 'immediate'];

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
  const telephone = normalizePhone(raw.telephone);
  const email = normEmail(raw.email);
  // Urgency comes from the level the agent states and from the words of the need; the higher wins,
  // so "normale" from the agent never hides a "fuite" in the description.
  const explicit = LEVELS.includes(raw.urgence) ? raw.urgence : null;
  const fromText = level([raw.urgence, raw.besoin].filter(Boolean).join(' '));
  const urgence = explicit && LEVELS.indexOf(explicit) > LEVELS.indexOf(fromText) ? explicit : fromText;

  const manquants = [];
  if (!nom) manquants.push('nom');
  if (!besoin) manquants.push('besoin');
  if (!telephone && !email) manquants.push('contact');

  return { nom, besoin, urgence, telephone, email, complet: manquants.length === 0, manquants };
}

/**
 * Combine what two steps of the same call learned about the caller. A field the later step leaves
 * empty keeps its earlier value, and urgency never goes down: once urgent, the call stays urgent.
 */
export function mergeCaller(earlier, later) {
  if (!earlier) return later ?? null;
  if (!later) return earlier;
  const pick = (k) => (later[k] !== null && later[k] !== undefined && later[k] !== '' ? later[k] : earlier[k] ?? null);
  const urgence = LEVELS.indexOf(later.urgence) >= LEVELS.indexOf(earlier.urgence) ? later.urgence : earlier.urgence;
  return qualify({ nom: pick('nom'), besoin: pick('besoin'), urgence, telephone: pick('telephone'), email: pick('email') });
}
