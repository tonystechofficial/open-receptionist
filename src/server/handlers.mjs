// The call flows: what the agent is told to say at each step, and what is booked, stored and sent.
// Decisions live in the pure core (src/core); this file wires them to the calendar, the store and
// the notifiers. Every tool call returns one line for the agent and never throws: an error in a
// webhook would leave the caller in silence. See docs/FLOWS.md for each flow in plain words.
import { qualify, mergeCaller } from '../core/qualify.mjs';
import { offerSlots, filterSlots, formatSlotFr, resolvePreferredDay, sameInstant, withoutSlot, exactSlot, parseHeure } from '../core/slots.mjs';
import { confirmationSms, ownerRecap, jobPlace } from '../core/messages.mjs';
import { normalizePhone, smsRefusal } from '../core/phone.mjs';
import { inZone } from '../core/zone.mjs';
import { transferDecision } from '../core/transfer.mjs';
import { crmPayload } from '../core/crm.mjs';
import { screenIncoming, recordUnroutable } from './screening.mjs';
import * as vapi from '../providers/voice/vapi.mjs';

const DAY_MS = 86_400_000;
const MISSING = { nom: 'le nom', besoin: 'le besoin', contact: 'un numéro de téléphone ou un email' };

/** Single entry point for everything the voice platform posts to the webhook. */
export async function handleVapiMessage(message, deps) {
  if (message?.type === 'assistant-request') return handleAssistantRequest(message, deps);
  if (message?.type === 'tool-calls') return handleToolCall(message, deps);
  if (vapi.isEndOfCall(message)) return handleCallReport(message, deps);
  return { ignored: true };
}

/**
 * Method 2 of call screening: when the phone number has no assistant of its own, Vapi asks which
 * assistant answers. A refused caller gets `{ error }`, which Vapi speaks before hanging up; an
 * allowed one gets the saved assistant. https://docs.vapi.ai/server-url/spam-call-rejection
 */
export async function handleAssistantRequest(message, deps) {
  const call = { number: normalizePhone(vapi.getCallerNumber(message)), via: 'vapi', providerCallId: vapi.getCallId(message) };
  const assistantId = deps.screening?.assistantId;
  if (!assistantId) {
    (deps.log ?? console.error)('[open-receptionist] assistant-request without VAPI_ASSISTANT_ID');
    return { error: await recordUnroutable(call, deps) };
  }
  const verdict = await screenIncoming(call, deps);
  return verdict.allow ? { assistantId } : { error: verdict.message };
}

export async function handleToolCall(message, deps) {
  const ctx = context(message, deps);
  const results = [];
  for (const call of vapi.getToolCalls(message)) {
    const name = call.function?.name ?? call.name;
    const toolCallId = call.id ?? call.toolCallId;
    const args = parseArgs(call.function?.arguments ?? call.arguments);
    let result;
    try {
      if (name === 'verifier_dispos') result = await checkAvailability(args, ctx);
      else if (name === 'prendre_rdv') result = await book(args, ctx);
      else if (name === 'noter_demande') result = await recordRequest(args, ctx);
      else if (name === 'demander_transfert') result = transferRequest(args, ctx);
      else result = `Outil inconnu : ${name}.`;
    } catch (error) {
      ctx.log('tool failed', name, error);
      result = `Je n'arrive pas à traiter cette demande pour le moment. Dis à l'appelant que ${ctx.company} le rappelle, et vérifie son numéro.`;
    }
    results.push({ name, toolCallId, result: oneLine(result) });
  }
  return vapi.toolResults(results);
}

/**
 * End of call: merge what the tools captured with Vapi's analysis, record the call in OUR
 * database, and send the owner one recap. A redelivered report is recognised and not resent,
 * unless the first recap reached nobody. What each channel did is kept in `deliveries`.
 */
export async function handleCallReport(message, deps) {
  if (!vapi.isEndOfCall(message)) return { ignored: true };
  const ctx = context(message, deps);
  const { store } = deps;

  const existing = await store.getCall(ctx.callId);
  if (existing?.recapSentAt) return { ok: true, duplicate: true, callId: ctx.callId };

  const analysis = vapi.getAnalysis(message);
  const fromAnalysis = analysis.structuredData ?? {};
  const fallback = qualify({
    nom: fromAnalysis.nom,
    besoin: fromAnalysis.besoin,
    urgence: fromAnalysis.urgence,
    telephone: fromAnalysis.telephone || ctx.callerNumber,
    email: fromAnalysis.email,
  });
  const caller = mergeCaller(fallback, existing?.caller ?? null); // what the tools captured wins
  const appointment = await store.findAppointmentByCallId(ctx.callId);
  const recap = ownerRecap({ company: ctx.company, caller, appointment, summary: analysis.summary });
  const endedAt = message.endedAt ?? ctx.now.toISOString();

  await store.upsertCall(ctx.callId, {
    caller,
    summary: analysis.summary,
    status: appointment ? 'rdv' : 'a_rappeler',
    urgent: recap.urgent,
    endedAt,
    endedReason: message.endedReason ?? null,
  });
  const sent = await sendOwnerRecap(recap, ctx);
  const crm = await forwardToCrm(crmPayload({ callId: ctx.callId, endedAt, caller, appointment, summary: analysis.summary }), ctx);
  const reached = sent.email.status === 'sent' || sent.sms.some((s) => s.status === 'sent');
  await store.upsertCall(ctx.callId, {
    deliveries: { ...(existing?.deliveries ?? {}), recap: sent, ...(crm ? { crm } : {}) },
    ...(reached ? { recapSentAt: ctx.now.toISOString() } : {}),
  });
  return { ok: true, callId: ctx.callId, recapSent: reached };
}

// ---------------------------------------------------------------- tools

async function checkAvailability(args, ctx) {
  // The service area is checked here, not left to the prompt: no slot is read for a town the
  // business does not serve, and none before the town is known when an area is set.
  const existing = await ctx.deps.store.getCall(ctx.callId);
  const town = args.ville || existing?.caller?.ville;
  if (args.ville) await ctx.deps.store.upsertCall(ctx.callId, { caller: mergeCaller(existing?.caller ?? null, qualify({ ville: args.ville })) });
  const served = inZone(town, ctx.config.infos?.zone);
  if (served === null) return "Demande d'abord la ville de l'intervention, puis rappelle verifier_dispos avec ville.";
  if (served === false) return outOfZone(town, ctx);

  const urgence = qualify({ urgence: args.urgence }).urgence;
  const preferredDay = resolvePreferredDay(args.jour, ctx.now, ctx.timeZone);
  const days = Math.min(30, Math.max(clampDays(args.jours), preferredDay ? daysUntilDate(preferredDay, ctx) + 1 : 0));
  const slots = await fetchSlots(ctx, days);

  // A time the caller named and that is free is the slot to confirm, not one of two to choose from.
  const exact = exactSlot(slots, { jour: args.jour, heure: args.heure }, ctx.now, ctx.timeZone);
  if (exact) {
    await ctx.deps.store.upsertCall(ctx.callId, { offered: [exact] });
    return `Le moment demandé est libre : option 1, ${formatSlotFr(exact, ctx.now, { timeZone: ctx.timeZone })}. Confirme-le avec l'appelant, puis appelle prendre_rdv avec creneau = 1.`;
  }

  const wished = filterSlots(slots, { jour: args.jour, moment: args.moment }, ctx.now, ctx.timeZone);
  const unmatched = wished.length === 0 && slots.length > 0; // a wish was given and nothing fits it
  const offer = offerSlots(unmatched ? slots : wished, urgence, ctx.now);
  await ctx.deps.store.upsertCall(ctx.callId, { offered: offer.options });

  if (offer.none) {
    return `Aucun créneau disponible dans les ${days} prochains jours. Propose que ${ctx.company} rappelle l'appelant, vérifie son numéro, puis appelle noter_demande.`;
  }
  const lead = [];
  if (urgence === 'immediate' && !offer.within) {
    lead.push(`Aucun créneau dans les 4 heures : dis que l'urgence est notée en priorité et que ${ctx.company} rappelle au plus vite, puis propose quand même ces créneaux.`);
  }
  if (parseHeure(args.heure)) lead.push("Ce moment précis n'est pas libre ; voici les plus proches.");
  else if (unmatched) lead.push('Aucun créneau ne correspond à ce souhait ; voici les plus proches.');
  return [...lead, describeOptions(offer.options, ctx)].join(' ');
}

async function book(args, ctx) {
  const { store, calendar } = ctx.deps;
  const existing = await store.getCall(ctx.callId);
  const start = resolveChoice(args.creneau, existing?.offered, ctx.now);

  // One booking per call. A repeated request confirms it again; a different slot is not booked
  // on top of it (the caller's change of mind goes to the owner as a call-back).
  const already = await store.findAppointmentByCallId(ctx.callId);
  if (already) {
    const label = formatSlotFr(already.at, ctx.now, { timeZone: ctx.timeZone });
    return !start || sameInstant(already.at, start)
      ? `Rendez-vous déjà confirmé pour ${label}. Ne réserve rien de plus.`
      : `Un rendez-vous est déjà pris pendant cet appel pour ${label}. Pour le changer, dis que ${ctx.company} rappelle l'appelant ; ne réserve pas un second créneau.`;
  }

  const caller = mergeCaller(existing?.caller ?? null, qualify({
    nom: args.nom, besoin: args.besoin, urgence: args.urgence, telephone: args.telephone || ctx.callerNumber, email: args.email,
    ville: args.ville, adresse: args.adresse,
  }));
  if (!caller.complet) {
    await store.upsertCall(ctx.callId, { caller });
    return `Il manque ${caller.manquants.map((m) => MISSING[m]).join(' et ')}. Demande-le à l'appelant avant de réserver, puis rappelle prendre_rdv.`;
  }
  const served = inZone(caller.ville, ctx.config.infos?.zone);
  if (served !== true) {
    await store.upsertCall(ctx.callId, { caller });
    if (served === null) return "Il manque la ville de l'intervention. Demande-la avant de réserver, puis rappelle prendre_rdv avec ville.";
    return outOfZone(caller.ville, ctx);
  }
  if (!start) return "Créneau non reconnu. Rappelle verifier_dispos et propose les options qu'il donne.";

  let booking;
  try {
    booking = await calendar.createBooking({
      start: new Date(start).toISOString(),
      name: caller.nom,
      email: caller.email ?? undefined,
      phone: caller.telephone ?? undefined,
      notes: [caller.besoin, jobPlace(caller)].filter(Boolean).join(' - '),
      timeZone: ctx.timeZone,
      metadata: { urgence: caller.urgence, callId: ctx.callId },
    });
  } catch (error) {
    return afterBookingFailure(error, start, caller, ctx);
  }

  const at = new Date(start).toISOString();
  const written = formatSlotFr(at, ctx.now, { timeZone: ctx.timeZone, style: 'written' });
  await store.saveAppointment({ callId: ctx.callId, at, label: written, caller, bookingRef: bookingRef(booking), createdAt: ctx.now.toISOString() });
  await store.upsertCall(ctx.callId, { caller, status: 'rdv' });
  const sms = await confirmToCaller(caller, written, ctx);
  await store.upsertCall(ctx.callId, { deliveries: { ...(existing?.deliveries ?? {}), callerSms: sms } });
  const spoken = formatSlotFr(at, ctx.now, { timeZone: ctx.timeZone });
  return `Rendez-vous confirmé pour ${spoken}.${sms.status === 'sent' ? " Dis à l'appelant qu'il va recevoir un SMS de confirmation." : ''} Demande-lui s'il a une autre question, puis conclus.`;
}

/** A refused booking is either a slot someone else just took (re-offer) or an outage (call-back). */
async function afterBookingFailure(error, start, caller, ctx) {
  let fresh = null;
  try {
    fresh = await fetchSlots(ctx, Math.max(7, Math.ceil((new Date(start).getTime() - ctx.now.getTime()) / DAY_MS) + 1));
  } catch {
    fresh = null;
  }
  if (Array.isArray(fresh) && !fresh.some((s) => sameInstant(s, start))) {
    const offer = offerSlots(withoutSlot(fresh, start), caller.urgence, ctx.now);
    await ctx.deps.store.upsertCall(ctx.callId, { caller, offered: offer.options });
    if (offer.none) return `Ce créneau vient d'être pris et il n'y a plus de créneau disponible. Propose que ${ctx.company} rappelle l'appelant.`;
    return `Ce créneau vient d'être pris. ${describeOptions(offer.options, ctx)}`;
  }
  ctx.log('booking failed', error);
  await ctx.deps.store.upsertCall(ctx.callId, { caller, status: 'a_rappeler', note: "réservation impossible : l'agenda a refusé" });
  return `Je n'arrive pas à enregistrer le rendez-vous pour le moment. Dis à l'appelant que ${ctx.company} le rappelle pour confirmer, et vérifie son numéro.`;
}

async function recordRequest(args, ctx) {
  const existing = await ctx.deps.store.getCall(ctx.callId);
  const caller = mergeCaller(existing?.caller ?? null, qualify({
    nom: args.nom, besoin: args.besoin, urgence: args.urgence, telephone: args.telephone || ctx.callerNumber, email: args.email,
    ville: args.ville, adresse: args.adresse,
  }));
  await ctx.deps.store.upsertCall(ctx.callId, { caller });
  const served = inZone(caller.ville, ctx.config.infos?.zone);
  if (served === false) return `Demande notée. ${outOfZone(caller.ville, ctx)}`;
  const urgent = caller.urgence === 'immediate' ? ' Elle est marquée urgente.' : '';
  const missing = caller.manquants.length
    ? ` Il manque encore ${caller.manquants.map((m) => MISSING[m]).join(' et ')} : demande-le si possible.`
    : '';
  const town = served === null ? " Demande aussi la ville de l'intervention." : '';
  return `Demande notée.${urgent}${missing}${town}`;
}

/** What the agent says when the business does not serve the caller's town: no slot, no booking. */
function outOfZone(town, ctx) {
  return `${ctx.company} n'intervient pas à ${town}. Dis-le poliment à l'appelant, sans proposer de créneau. S'il a un besoin dans une commune desservie, reprends avec cette commune.`;
}

// ---------------------------------------------------------------- helpers

/**
 * Asked before the agent transfers a call (FLOWS 16): only an emergency or a caller asking for a
 * person, within the transfer hours. Otherwise the request goes the call-back way.
 */
function transferRequest(args, ctx) {
  const hours = ctx.config.transfert?.horaires;
  const decision = transferDecision({ reason: args.motif, now: ctx.now, hours, timeZone: ctx.timeZone });
  if (decision.allowed) {
    return `Transfert autorisé. Dis à l'appelant que tu le mets en relation avec ${ctx.company}, puis appelle transferCall. Si personne ne répond, note la demande avec noter_demande et dis que ${ctx.company} rappelle au plus vite.`;
  }
  if (decision.why === 'reason') {
    return "Le transfert est réservé aux urgences et aux appelants qui demandent à parler à une personne. Continue la conversation sans transférer.";
  }
  if (decision.why === 'bad-hours') ctx.log('transfer hours unreadable, transfer refused', hours);
  const urgent = args.motif === 'urgence';
  return `Pas de transfert possible maintenant. Appelle noter_demande${urgent ? ' en urgence immédiate (urgence = immediate)' : ''}, vérifie le numéro de rappel et dis que ${ctx.company} rappelle au plus vite.${urgent ? ' Propose quand même le créneau le plus proche.' : ''}`;
}

function context(message, deps) {
  const config = deps.config ?? {};
  return {
    deps,
    config,
    company: config.company ?? "l'entreprise",
    timeZone: config.timeZone ?? 'Europe/Paris',
    now: deps.now ? deps.now() : new Date(),
    callId: vapi.getCallId(message) ?? 'appel-sans-identifiant',
    callerNumber: vapi.getCallerNumber(message),
    log: deps.log ?? ((...a) => console.error('[open-receptionist]', ...a)),
  };
}

function describeOptions(options, ctx) {
  const listed = options.map((s, i) => `option ${i + 1}, ${formatSlotFr(s, ctx.now, { timeZone: ctx.timeZone })}`);
  const keys = options.map((_, i) => i + 1).join(' ou ');
  return `Créneaux à proposer : ${listed.join(' ; ')}. Propose ces options telles quelles, sans lire de date technique. Quand l'appelant choisit, appelle prendre_rdv avec creneau = ${keys}.`;
}

async function fetchSlots(ctx, days) {
  const from = ctx.now.toISOString();
  const to = new Date(ctx.now.getTime() + days * DAY_MS).toISOString();
  return ctx.deps.calendar.getAvailableSlots({ from, to, timeZone: ctx.timeZone });
}

/** "1", "option 2" -> the slot offered earlier in this call; an ISO datetime in the future is accepted as is. */
function resolveChoice(creneau, offered, now) {
  const value = String(creneau ?? '').trim();
  if (!value) return null;
  const n = Number(value.replace(/^option\s*/i, ''));
  if (Number.isInteger(n) && n >= 1 && Array.isArray(offered) && offered[n - 1]) return offered[n - 1];
  // A bare "1" would parse as a date in the year 2001: only real ISO datetimes count.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > now.getTime() ? value : null;
}

// A delivery is { status: 'sent' | 'failed' | 'skipped', to?, reason?, at }. It is stored on the call,
// so a refused SMS leaves a trace that the daily check reports, not just a log line.

/**
 * The caller's confirmation SMS. Only a mobile in a listed country receives it (France by default):
 * a landline caller is not promised one, and a dictated foreign number cannot be used for SMS pumping.
 */
async function confirmToCaller(caller, label, ctx) {
  const at = ctx.now.toISOString();
  const to = caller.telephone;
  if (ctx.config.confirmation?.sms === false) return { status: 'skipped', reason: 'confirmation par SMS désactivée', at };
  if (!ctx.deps.notify?.sms) return { status: 'skipped', reason: 'aucun fournisseur SMS', at };
  if (!to) return { status: 'skipped', reason: 'aucun numéro', at };
  const refusal = smsRefusal(to, ctx.config.smsCountries);
  if (refusal) return { status: 'skipped', to, reason: refusal, at };
  try {
    await ctx.deps.notify.sms({
      to,
      content: confirmationSms({ company: ctx.company, label, contactPhone: ctx.config.telephone, tarifsUrl: ctx.config.infos?.tarifsUrl }),
      sender: ctx.config.smsSender,
    });
    return { status: 'sent', to, at };
  } catch (error) {
    ctx.log('caller sms failed', error);
    return { status: 'failed', to, reason: reasonOf(error), at };
  }
}

/** The owner's recap by email (the record) and by SMS (on top). Returns what each channel did. */
async function sendOwnerRecap(recap, ctx) {
  const to = ctx.config.notify ?? {};
  const notify = ctx.deps.notify ?? {};
  const at = ctx.now.toISOString();
  const sent = { email: null, sms: [] };

  if (!to.email?.length) sent.email = { status: 'skipped', reason: 'aucun destinataire email', at };
  else if (!notify.email) sent.email = { status: 'failed', reason: 'aucun fournisseur email (RESEND_API_KEY)', at };
  else {
    try {
      await notify.email({ to: to.email, subject: recap.subject, text: recap.text, html: recap.html });
      sent.email = { status: 'sent', at };
    } catch (error) {
      ctx.log('owner email failed', error);
      sent.email = { status: 'failed', reason: reasonOf(error), at };
    }
  }

  for (const number of to.sms ?? []) {
    if (!notify.sms) {
      sent.sms.push({ status: 'skipped', to: number, reason: 'aucun fournisseur SMS', at });
      continue;
    }
    try {
      await notify.sms({ to: number, content: recap.sms, sender: ctx.config.smsSender });
      sent.sms.push({ status: 'sent', to: number, at });
    } catch (error) {
      ctx.log('owner sms failed', error);
      sent.sms.push({ status: 'failed', to: number, reason: reasonOf(error), at });
    }
  }
  return sent;
}

/** The end of the call to the CRM (CRM_WEBHOOK_URL), when one is set; null otherwise. */
async function forwardToCrm(payload, ctx) {
  if (!ctx.deps.crm) return null;
  const at = ctx.now.toISOString();
  try {
    await ctx.deps.crm(payload);
    return { status: 'sent', at };
  } catch (error) {
    ctx.log('crm forward failed', error);
    return { status: 'failed', reason: reasonOf(error), at };
  }
}

function reasonOf(error) {
  return String(error?.message ?? error).slice(0, 300);
}

function clampDays(jours) {
  const n = Number(jours);
  return Number.isFinite(n) && n >= 1 ? Math.min(30, Math.round(n)) : 7;
}

function daysUntilDate(isoDate, ctx) {
  const today = resolvePreferredDay("aujourd'hui", ctx.now, ctx.timeZone);
  return Math.max(0, Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS));
}

function bookingRef(b) {
  const ref = b?.data?.uid ?? b?.uid ?? b?.data?.id ?? b?.id;
  return ref === undefined || ref === null ? null : String(ref);
}

function oneLine(s) { return String(s).replace(/\s+/g, ' ').trim(); }

function parseArgs(a) {
  if (!a) return {};
  if (typeof a === 'object') return a;
  try { return JSON.parse(a); } catch { return {}; }
}
