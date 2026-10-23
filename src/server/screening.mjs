// Screens an incoming call before the receptionist answers. The decision is pure (core/screening);
// this file reads the counts from the store, records the attempt, and says what a refused caller hears.
// Both entries use it: Twilio's webhook (method 1) and Vapi's assistant-request (method 2).
import { screenCall, refusalMessage } from '../core/screening.mjs';

/**
 * @param {{number: string|null, via: 'twilio'|'vapi', providerCallId?: string}} call `number` in E.164,
 *   or null when withheld.
 * @returns {Promise<{allow: true} | {allow: false, reason: string, message: string}>}
 */
export async function screenIncoming({ number, via, providerCallId }, deps) {
  const { store, screening = {}, config = {} } = deps;
  const now = deps.now ? deps.now() : new Date();
  const counts = await store.attemptCounts({ number, now });
  const verdict = screenCall({ number, blocked: screening.blocked ?? [], counts, limits: screening.limits });
  await store.recordAttempt({
    number, at: now.toISOString(), decision: verdict.allow ? 'allowed' : 'refused',
    reason: verdict.allow ? null : verdict.reason, via, providerCallId,
  });
  return verdict.allow ? verdict : { ...verdict, message: refusalMessage(verdict.reason, config.company ?? "l'entreprise") };
}

/** A call that cannot be routed (no assistant configured) is recorded as refused, with that reason. */
export async function recordUnroutable({ number, via, providerCallId }, deps) {
  const now = deps.now ? deps.now() : new Date();
  await deps.store.recordAttempt({ number, at: now.toISOString(), decision: 'refused', reason: 'no-assistant', via, providerCallId });
  return refusalMessage('no-assistant', deps.config?.company ?? "l'entreprise");
}
