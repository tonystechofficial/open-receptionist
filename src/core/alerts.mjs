// Pure: turn what the calls recorded into the problems the daily check reports, and the alert email.
import { formatPhoneFr, escapeHtml } from './messages.mjs';

function who(call) {
  const c = call.caller ?? {};
  return c.nom || formatPhoneFr(c.telephone) || 'un appelant';
}

/** Every failed delivery, and every ended call whose recap was never attempted. */
export function deliveryProblems(calls = []) {
  const problems = [];
  for (const call of calls) {
    const label = `Appel de ${who(call)} (${call.callId})`;
    const d = call.deliveries ?? {};
    if (d.callerSms?.status === 'failed') {
      problems.push(`${label} : SMS de confirmation non envoyé au ${formatPhoneFr(d.callerSms.to)} (${d.callerSms.reason})`);
    }
    if (d.recap?.email?.status === 'failed') {
      problems.push(`${label} : récapitulatif par email non envoyé (${d.recap.email.reason})`);
    }
    for (const s of d.recap?.sms ?? []) {
      if (s.status === 'failed') problems.push(`${label} : récapitulatif par SMS non envoyé au ${formatPhoneFr(s.to)} (${s.reason})`);
    }
    if (call.endedAt && !call.recapSentAt && !d.recap) problems.push(`${label} : appel terminé sans récapitulatif`);
  }
  return problems;
}

const REPEAT_CALLS = 5; // from one number in 24 hours: more than a customer chasing an answer

/** Calls that cost more than they should: cut at the time cap, or one number calling again and again. */
export function callProblems(calls = []) {
  const problems = [];
  const byNumber = new Map();
  for (const call of calls) {
    if (call.endedReason === 'exceeded-max-duration') {
      problems.push(`Appel de ${who(call)} (${call.callId}) : coupé à la durée maximale. Conversation qui tourne en rond, ou abus ?`);
    }
    const number = call.caller?.telephone;
    if (number) byNumber.set(number, (byNumber.get(number) ?? 0) + 1);
  }
  for (const [number, count] of byNumber) {
    if (count >= REPEAT_CALLS) {
      problems.push(`Le ${formatPhoneFr(number)} a appelé ${count} fois en 24 heures : abus possible, chaque minute est facturée.`);
    }
  }
  return problems;
}

const REFUSAL_LABEL = {
  blocked: 'numéro bloqué',
  'number-hour': "trop d'appels du même numéro dans l'heure",
  'number-day': "trop d'appels du même numéro dans la journée",
  anonymous: "vague d'appels en numéro masqué",
  total: "plafond d'appels par heure atteint",
};

/** The calls the screen turned away, summed up per number and reason, one line each. */
export function screeningProblems(attempts = []) {
  const groups = new Map();
  for (const a of attempts) {
    if (a.decision !== 'refused') continue;
    const key = `${a.number ?? ''}|${a.reason}`;
    groups.set(key, { number: a.number, reason: a.reason, count: (groups.get(key)?.count ?? 0) + 1 });
  }
  return [...groups.values()].map(({ number, reason, count }) => {
    if (reason === 'no-assistant') {
      return `Configuration : VAPI_ASSISTANT_ID manquant, ${count} appel(s) n'ont pas pu être confiés à l'assistant.`;
    }
    const who = number ? `du ${formatPhoneFr(number)}` : 'en numéro masqué';
    return `${count} appel(s) ${who} refusé(s) en 24 heures : ${REFUSAL_LABEL[reason] ?? reason}.`;
  });
}

const LOW_SMS_CREDITS = 20; // Brevo counts credits: about ten bookings, a confirmation and a recap each
const LOW_BALANCE = 5; // Twilio counts money and recharges itself under 10 by default: below 5, it failed

/** What the SMS provider's check says about the credit left, or null when there is enough. */
export function creditProblem(provider, result = {}) {
  if (provider === 'brevo' && result.smsCredits != null && result.smsCredits < LOW_SMS_CREDITS) {
    return `Crédits SMS Brevo presque épuisés : ${result.smsCredits} restants.`;
  }
  if (provider === 'twilio' && Number.isFinite(result.balance) && result.balance < LOW_BALANCE) {
    return `Solde Twilio bas : ${result.balance.toFixed(2)} ${result.currency}. Vérifiez la recharge automatique : à zéro, plus aucun SMS ne part.`;
  }
  return null;
}

const WAVE = {
  total: "le plafond d'appels par heure, tous appelants confondus, est atteint",
  anonymous: "trop d'appels en numéro masqué arrivent dans l'heure",
};

/** The email sent at once, when a wave of calls starts being turned away. */
export function floodAlertEmail({ company, reason, at }) {
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(at);
  const subject = `[open-receptionist] ${company} : vague d'appels, des appelants sont refusés`;
  const lines = [
    `Depuis ${time} (heure de Paris), ${WAVE[reason] ?? reason} : les appels suivants sont refusés avant que l'assistant ne réponde.`,
    "Chaque appelant refusé entend le 112 pour une urgence. Les appels reprennent d'eux-mêmes quand le rythme redescend.",
    "Si c'est une vraie affluence, rien à faire. Si des numéros abusent, ajoutez-les à BLOCKED_NUMBERS. Le détail sera dans le rapport quotidien.",
    "Si vous n'avez pas installé ce standard, transférez ce message à la personne qui l'a fait.",
  ];
  return { subject, text: lines.join('\n'), html: `<p>${lines.map(escapeHtml).join('</p><p>')}</p>` };
}

/** The email the daily check sends when it finds something. It may reach the owner, hence the forward line. */
export function alertEmail({ company, problems }) {
  const n = problems.length;
  const subject = `[open-receptionist] ${company} : ${n} problème${n > 1 ? 's' : ''} d'envoi à corriger`;
  const intro = `Le contrôle quotidien du standard de ${company} a trouvé ${n > 1 ? `${n} problèmes` : 'un problème'}. `
    + "Si vous n'avez pas installé ce standard, transférez ce message à la personne qui l'a fait.";
  const text = [intro, '', ...problems.map((p) => `- ${p}`)].join('\n');
  const html = `<p>${escapeHtml(intro)}</p><ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
  return { subject, text, html };
}
