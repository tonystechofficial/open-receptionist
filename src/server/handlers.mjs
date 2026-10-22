// Business logic that wires the pure core to the providers and the store.
// Integration glue (no unit tests here); the decisions it relies on are tested in src/core.
import { qualify } from '../core/qualify.mjs';
import * as vapi from '../providers/voice/vapi.mjs';

/**
 * Handle a `tool-calls` webhook: the model asked to read availability or book.
 * deps: { calendar, notify, store, config }
 */
export async function handleToolCall(message, deps) {
  const results = [];
  for (const call of vapi.getToolCalls(message)) {
    const name = call.function?.name ?? call.name;
    const args = parseArgs(call.function?.arguments ?? call.arguments);
    const id = call.id ?? call.toolCallId;

    if (name === 'verifier_dispos') {
      const jours = Number(args.jours) || 7;
      const from = new Date().toISOString();
      const to = new Date(Date.now() + jours * 86400_000).toISOString();
      const slots = await deps.calendar.getAvailableSlots({ from, to });
      results.push({ toolCallId: id, result: slots.slice(0, 20).join(', ') || 'aucun créneau disponible' });
    } else if (name === 'prendre_rdv') {
      const q = qualify({ nom: args.nom, besoin: args.besoin, telephone: args.telephone, email: args.email });
      const booking = await deps.calendar.createBooking({
        start: args.creneau, name: q.nom || args.nom, email: q.email, phone: q.telephone, notes: q.besoin,
      });
      await deps.store.saveAppointment({ at: args.creneau, caller: q, booking, ts: Date.now() });
      results.push({ toolCallId: id, result: `Rendez-vous confirmé pour ${args.creneau}.` });
    } else {
      results.push({ toolCallId: id, result: `Outil inconnu : ${name}` });
    }
  }
  return vapi.toolResults(results);
}

/**
 * Handle the `end-of-call-report` webhook: persist the call to YOUR DB (the source of truth)
 * and send the recap. With Zero Data Retention on, this is the only place the content survives.
 */
export async function handleCallReport(message, deps) {
  if (!vapi.isEndOfCall(message)) return { ignored: true };
  const raw = vapi.extractStructuredData(message);
  const q = qualify({ nom: raw.nom, besoin: raw.besoin, urgence: raw.urgence, telephone: raw.telephone, email: raw.email });
  const record = {
    caller: q,
    souhaite: raw.creneau_souhaite ?? null,
    summary: message.analysis?.summary ?? null,
    endedAt: message.endedAt ?? new Date().toISOString(),
  };
  const saved = await deps.store.saveCall(record);
  await sendRecap(saved, deps);
  return { ok: true, id: saved.id };
}

async function sendRecap(rec, deps) {
  const q = rec.caller;
  const line = `Appel : ${q.nom || '?'} — ${q.besoin || '?'} — urgence ${q.urgence} — ${q.telephone || q.email || 'pas de contact'}${rec.souhaite ? ` — souhait : ${rec.souhaite}` : ''}`;
  const to = deps.config?.notify || {};
  if (deps.notify?.email && Array.isArray(to.email) && to.email.length) {
    await deps.notify.email({ to: to.email, subject: `Nouvel appel — ${q.nom || 'inconnu'}`, html: `<p>${escapeHtml(line)}</p>`, text: line });
  }
  if (deps.notify?.sms && Array.isArray(to.sms) && to.sms.length) {
    for (const n of to.sms) await deps.notify.sms({ to: n, content: line.slice(0, 300) });
  }
}

function parseArgs(a) {
  if (!a) return {};
  if (typeof a === 'object') return a;
  try { return JSON.parse(a); } catch { return {}; }
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
