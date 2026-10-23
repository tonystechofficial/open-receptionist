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
