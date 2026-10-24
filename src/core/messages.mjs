// Pure message building: the confirmation SMS sent to the caller and the recap sent to the owner.

// Characters outside the GSM 03.38 basic alphabet. One of them in an SMS drops the capacity from
// 160 to 70 characters and can double the cost, so they are replaced by their closest equivalent.
const GSM_REPLACEMENTS = {
  'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ë': 'e', 'ï': 'i', 'ÿ': 'y', 'ç': 'c',
  'œ': 'oe', 'Œ': 'OE', 'Â': 'A', 'Ê': 'E', 'Î': 'I', 'Ô': 'O', 'Û': 'U', 'È': 'E', 'À': 'A', 'Ù': 'U',
  'Ë': 'E', 'Ï': 'I', '’': "'", '‘': "'", '“': '"', '”': '"', '«': '"', '»': '"',
  '—': '-', '–': '-', '…': '...', ' ': ' ', ' ': ' ',
};
const GSM_PATTERN = new RegExp(`[${Object.keys(GSM_REPLACEMENTS).join('')}]`, 'g');

export function toGsm7(text) {
  return String(text ?? '').replace(GSM_PATTERN, (c) => GSM_REPLACEMENTS[c]);
}

/** A French number written the way it is read: "06 12 34 56 78". Other numbers are left as they are. */
export function formatPhoneFr(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/[^\d+]/g, '');
  let national = null;
  if (/^\+33\d{9}$/.test(digits)) national = `0${digits.slice(3)}`;
  else if (/^0\d{9}$/.test(digits)) national = digits;
  if (!national) return String(phone);
  return national.replace(/(\d{2})(?=\d)/g, '$1 ');
}

/**
 * The SMS the caller receives once the appointment is booked. `label` is an absolute, written date.
 * With a published rates page, its link puts the price information in writing (home repair in France
 * must give it before the work); the SMS may then take two segments.
 */
export function confirmationSms({ company, label, contactPhone, tarifsUrl }) {
  const parts = [`${company} : votre rendez-vous est confirmé pour le ${label}.`];
  if (contactPhone) parts.push(`Pour le modifier, appelez le ${formatPhoneFr(contactPhone)}.`);
  if (tarifsUrl) parts.push(`Tarifs : ${tarifsUrl}`);
  return toGsm7(parts.join(' '));
}

/** Where the job is, as one line: "12 rue des Lilas, Mérignac". Empty when unknown. */
export function jobPlace(caller) {
  return [caller?.adresse, caller?.ville].filter(Boolean).join(', ');
}

const URGENCE_LABEL = { immediate: 'immédiate', haute: 'sous 48 h', normale: 'normale' };

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

/** The recap the business owner receives after every call: an email and a one-line SMS. */
export function ownerRecap({ company, caller = {}, appointment = null, summary = null }) {
  const c = caller ?? {};
  const urgent = c.urgence === 'immediate';
  const phone = formatPhoneFr(c.telephone);
  const rdv = appointment?.label ?? null;

  const subject = `${urgent ? '[URGENT] ' : ''}Appel de ${c.nom || 'un appelant'} : ${rdv ? `RDV ${rdv}` : 'à rappeler'}`;
  const lines = [
    `Nom : ${c.nom || 'non donné'}`,
    `Besoin : ${c.besoin || 'non précisé'}`,
    `Urgence : ${URGENCE_LABEL[c.urgence] || 'normale'}`,
    `Téléphone : ${phone || 'non donné'}`,
    `Adresse : ${jobPlace(c) || 'non donnée'}`,
    `Email : ${c.email || 'non donné'}`,
    `Rendez-vous : ${rdv || 'aucun, à rappeler'}`,
  ];
  if (summary) lines.push(`Résumé : ${summary}`);
  const text = lines.join('\n');
  const html = `<p>${lines.map(escapeHtml).join('<br>')}</p><p style="color:#666">${escapeHtml(company ?? '')}</p>`;
  const sms = toGsm7(
    `${urgent ? 'URGENT ' : ''}${c.nom || 'Appelant'}${phone ? ` ${phone}` : ''} : ${truncate(c.besoin || 'demande', 60)}${c.ville ? ` (${c.ville})` : ''}. ${rdv ? `RDV ${rdv}` : 'à rappeler'}.`,
  );
  return { subject, text, html, sms, urgent };
}
