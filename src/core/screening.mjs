// Pure: decide whether an incoming call may reach the receptionist, before anything answers it.
// Every minute is billed, so a blocked number, a number that keeps calling, a wave of withheld
// numbers, or an unusual number of calls in the hour are turned away. The counts are the calls
// already let through; the store provides them.
import { normalizePhone } from './phone.mjs';

export const DEFAULT_LIMITS = { perNumberHour: 4, perNumberDay: 8, anonymousHour: 5, totalHour: 30 };

/** Limits from the environment. Anything but a positive whole number keeps the default. */
export function screeningLimits(env = {}) {
  const pick = (value, fallback) => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    perNumberHour: pick(env.SCREEN_PER_NUMBER_HOUR, DEFAULT_LIMITS.perNumberHour),
    perNumberDay: pick(env.SCREEN_PER_NUMBER_DAY, DEFAULT_LIMITS.perNumberDay),
    anonymousHour: pick(env.SCREEN_ANONYMOUS_HOUR, DEFAULT_LIMITS.anonymousHour),
    totalHour: pick(env.SCREEN_TOTAL_HOUR, DEFAULT_LIMITS.totalHour),
  };
}

/** BLOCKED_NUMBERS, comma-separated and written any usual way, as E.164. */
export function blockedNumbers(list) {
  return String(list ?? '').split(',').map(normalizePhone).filter(Boolean);
}

/**
 * @param {{number: string|null, blocked?: string[], counts: {numberHour:number, numberDay:number, anonymousHour:number, totalHour:number}, limits?: object}} input
 *   `number` is E.164, or null for a withheld number.
 * @returns {{allow: true} | {allow: false, reason: 'blocked'|'total'|'anonymous'|'number-hour'|'number-day'}}
 */
export function screenCall({ number, blocked = [], counts, limits = DEFAULT_LIMITS }) {
  if (number && blocked.includes(number)) return { allow: false, reason: 'blocked' };
  if (counts.totalHour >= limits.totalHour) return { allow: false, reason: 'total' };
  if (!number) {
    return counts.anonymousHour >= limits.anonymousHour ? { allow: false, reason: 'anonymous' } : { allow: true };
  }
  if (counts.numberHour >= limits.perNumberHour) return { allow: false, reason: 'number-hour' };
  if (counts.numberDay >= limits.perNumberDay) return { allow: false, reason: 'number-day' };
  return { allow: true };
}

const EMERGENCY = "En cas d'urgence, composez le 112.";

/** What a turned-away caller hears. It always leaves a way out for an emergency. */
export function refusalMessage(reason, company) {
  switch (reason) {
    case 'blocked': return `Ce numéro ne peut pas joindre ${company}. ${EMERGENCY}`;
    case 'number-hour':
    case 'number-day': return `Vos appels précédents ont bien été transmis à ${company}, qui vous rappelle. ${EMERGENCY}`;
    case 'anonymous': return `Trop d'appels en numéro masqué en ce moment. Merci de rappeler sans masquer votre numéro. ${EMERGENCY}`;
    case 'total': return `${company} reçoit trop d'appels en ce moment. Merci de rappeler un peu plus tard. ${EMERGENCY}`;
    default: return `Le service est momentanément indisponible. Merci de rappeler plus tard. ${EMERGENCY}`;
  }
}
