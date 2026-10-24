// Screens an incoming call before the receptionist answers. The decision is pure (core/screening);
// this file reads the counts from the store, records the attempt, alerts the operator when a wave
// starts, and says what a refused caller hears. Both entries use it: Twilio's webhook (method 1) and
// Vapi's assistant-request (method 2).
import { screenCall, refusalMessage, floodAlertDue } from '../core/screening.mjs';
import { floodAlertEmail } from '../core/alerts.mjs';

const HOUR_MS = 3_600_000;

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
  if (verdict.allow) return verdict;

  const company = config.company ?? "l'entreprise";
  await alertIfWaveStarts(verdict.reason, now, company, deps);
  return { ...verdict, message: refusalMessage(verdict.reason, company) };
}

/** A call that cannot be routed (no assistant configured) is recorded as refused, with that reason. */
export async function recordUnroutable({ number, via, providerCallId }, deps) {
  const now = deps.now ? deps.now() : new Date();
  await deps.store.recordAttempt({ number, at: now.toISOString(), decision: 'refused', reason: 'no-assistant', via, providerCallId });
  return refusalMessage('no-assistant', deps.config?.company ?? "l'entreprise");
}

/** Emails the operator on the first refusal of a wave in the hour. A failed alert never blocks screening. */
async function alertIfWaveStarts(reason, now, company, deps) {
  if (!deps.alert) return;
  try {
    const recent = await deps.store.attemptsSince(new Date(now.getTime() - HOUR_MS).toISOString());
    const same = recent.filter((a) => a.decision === 'refused' && a.reason === reason).length;
    if (floodAlertDue(reason, same)) await deps.alert(floodAlertEmail({ company, reason, at: now }));
  } catch (error) {
    (deps.log ?? console.error)('[open-receptionist] flood alert failed', error);
  }
}
