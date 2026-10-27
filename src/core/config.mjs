// Per-client configuration: one template assistant + one webhook are driven by this object.
import { normalizePhone, canReceiveSms } from './phone.mjs';
import { parseTransferHours } from './transfer.mjs';

const DEFAULTS = {
  parcours: 'intervention', // the trades flow; 'decouverte' books a first exchange for a service business
  language: 'fr',
  timeZone: 'Europe/Paris',
  recordingEnabled: false, // off by default; see docs/DATA.md
  maxDurationSeconds: 300, // qualifying, choosing a slot and confirming can run past 3 minutes
  silenceTimeoutSeconds: 30, // hang up after this long without speech; Vapi does not document its default
  voice: { provider: 'azure', voiceId: 'fr-FR-DeniseNeural' },
  confirmation: { sms: true }, // SMS the caller once the appointment is booked
  smsCountries: ['33'], // dialling codes that may receive an SMS: France only, against SMS pumping
};

// Sender names French carriers filter as generic: Twilio's France guidelines name SMS, Info, Verify,
// Help, Support and Assistance; Infos, Aide and Accueil are their French twins.
const GENERIC_SENDERS = new Set(['SMS', 'INFO', 'INFOS', 'VERIFY', 'HELP', 'SUPPORT', 'ASSISTANCE', 'AIDE', 'ACCUEIL']);

/**
 * The client configuration from the Worker's settings: the [vars] of wrangler.toml, or the environment
 * of the Node entry. Empty settings are left unset, so validateClientConfig applies its defaults.
 */
export function configFromVars(vars) {
  const list = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    company: vars.CLIENT_COMPANY,
    metier: vars.CLIENT_METIER,
    horaires: vars.CLIENT_HORAIRES,
    telephone: vars.CLIENT_TELEPHONE || undefined,
    timeZone: vars.TIME_ZONE || undefined,
    smsSender: vars.SMS_SENDER || undefined,
    smsCountries: list(vars.SMS_COUNTRIES),
    // The Worker enforces the service area; the rest of the business information lives in the assistant.
    infos: { zone: list(vars.CLIENT_ZONE), tarifsUrl: vars.CLIENT_TARIFS_URL || undefined },
    confirmation: { sms: vars.CONFIRM_CALLER_SMS !== 'false' },
    calendar: { provider: 'calcom', id: vars.CALCOM_EVENT_TYPE_ID },
    notify: { email: list(vars.NOTIFY_EMAIL), sms: list(vars.NOTIFY_SMS) },
    // The Worker only needs the hours to decide; the number lives in the assistant (config/client.json).
    ...(vars.TRANSFER_HOURS ? { transfert: { horaires: vars.TRANSFER_HOURS } } : {}),
  };
}

/**
 * @param {object} cfg
 * @param {{providers?: {email:boolean, sms:boolean}}} [options] which provider keys are set, when
 *   the caller knows; the rules that depend on them are skipped otherwise.
 * @returns {{ok:boolean, errors:string[], warnings:string[], config:object}}
 */
export function validateClientConfig(cfg = {}, { providers } = {}) {
  const errors = [];
  const warnings = [];

  if (!cfg.company || !String(cfg.company).trim()) errors.push('company is required');
  if (!cfg.metier || !String(cfg.metier).trim()) errors.push('metier is required');
  if (!cfg.calendar || !cfg.calendar.provider || !cfg.calendar.id) {
    errors.push('calendar.provider and calendar.id are required');
  }

  // The email recap is the record of every call and SMS only comes on top: a recap sent by SMS alone
  // is lost without a trace the day the SMS provider refuses to send.
  const notify = cfg.notify || {};
  const emails = Array.isArray(notify.email) ? notify.email.filter(Boolean) : [];
  if (emails.length === 0) {
    errors.push('notify.email is required: the email recap is the record of every call, SMS only comes on top');
  }
  const smsCountries = Array.isArray(cfg.smsCountries) && cfg.smsCountries.length ? cfg.smsCountries.map(String) : DEFAULTS.smsCountries;
  const sms = [];
  for (const raw of Array.isArray(notify.sms) ? notify.sms.filter(Boolean) : []) {
    const number = normalizePhone(raw);
    if (!number) errors.push(`notify.sms: "${raw}" is not a phone number`);
    else if (!canReceiveSms(number, smsCountries)) {
      errors.push(`notify.sms: ${raw} cannot receive SMS: give a mobile (06 or 07), or list its country in smsCountries`);
    } else sms.push(number);
  }

  // Operators accept an alphanumeric sender of 3 to 11 characters, with at least one letter (digits
  // alone read as a phone number); anything else is rejected at send time.
  const sender = cfg.smsSender == null ? null : String(cfg.smsSender);
  if (sender !== null && !/^[A-Za-z0-9]{3,11}$/.test(sender)) {
    errors.push('smsSender must be 3 to 11 letters or digits');
  } else if (sender !== null && !/[A-Za-z]/.test(sender)) {
    errors.push('smsSender needs at least one letter: digits alone read as a phone number');
  } else if (sender !== null && GENERIC_SENDERS.has(sender.toUpperCase())) {
    errors.push(`smsSender "${sender}" is too generic: carriers filter names like Info or Accueil, use the business's short name`);
  }

  // Every minute is billed: the limits on call length stay within sane bounds, so a typo cannot
  // leave a silent or looping call running for hours (Vapi accepts up to 12 hours).
  const between = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (cfg.maxDurationSeconds != null && !between(cfg.maxDurationSeconds, 60, 1800)) {
    errors.push('maxDurationSeconds must be a whole number of seconds from 60 to 1800 (30 minutes)');
  }
  if (cfg.silenceTimeoutSeconds != null && !between(cfg.silenceTimeoutSeconds, 10, 120)) {
    errors.push('silenceTimeoutSeconds must be a whole number of seconds from 10 to 120');
  }

  // What the agent may tell callers about the business. It reads these out exactly as written, so
  // their shape is checked: a typo must not turn into something said to a caller.
  const infos = cfg.infos ?? {};
  const texts = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
  for (const field of ['prestations', 'horsPrestations', 'zone', 'paiement']) {
    if (infos[field] !== undefined && !texts(infos[field])) errors.push(`infos.${field} must be a list of texts`);
  }
  if (infos.tarifs !== undefined) {
    const t = infos.tarifs;
    if (typeof t !== 'object' || t === null) errors.push('infos.tarifs must be an object');
    else {
      for (const k of ['deplacement', 'tauxHoraire', 'devis']) {
        if (t[k] !== undefined && typeof t[k] !== 'string') errors.push(`infos.tarifs.${k} must be a text`);
      }
      if (t.forfaits !== undefined && !texts(t.forfaits)) errors.push('infos.tarifs.forfaits must be a list of texts');
    }
  }
  const faqOk = (f) => f && typeof f.question === 'string' && typeof f.reponse === 'string';
  if (infos.faq !== undefined && !(Array.isArray(infos.faq) && infos.faq.every(faqOk))) {
    errors.push('infos.faq must be a list of { question, reponse } texts');
  }
  if (infos.tarifsUrl !== undefined && !/^https:\/\/\S+$/.test(String(infos.tarifsUrl))) {
    errors.push('infos.tarifsUrl must be an https:// address');
  }

  // The journey: 'intervention' (a job at the caller's, the default) or 'decouverte' (a first exchange
  // with a service business). The discovery settings are read out to callers, so their shape is checked.
  if (cfg.parcours !== undefined && !['intervention', 'decouverte'].includes(cfg.parcours)) {
    errors.push('parcours must be "intervention" or "decouverte"');
  }
  for (const field of ['interlocuteur', 'presentation']) {
    if (cfg[field] !== undefined && (typeof cfg[field] !== 'string' || !cfg[field].trim())) errors.push(`${field} must be a text`);
  }
  if (cfg.echange !== undefined) {
    const e = cfg.echange;
    if (typeof e !== 'object' || e === null || typeof e.quoi !== 'string' || !e.quoi.trim()) {
      errors.push('echange.quoi must be a text, such as "un échange gratuit de vingt minutes avec Tony, par téléphone"');
    } else if (e.pourquoi !== undefined && typeof e.pourquoi !== 'string') errors.push('echange.pourquoi must be a text');
  }
  const question = (q) => q && /^[a-z0-9_]+$/.test(q.offre ?? '') && typeof q.pour === 'string' && typeof q.situation === 'string';
  if (cfg.qualification !== undefined && !(Array.isArray(cfg.qualification) && cfg.qualification.every(question))) {
    errors.push('qualification must be a list of { offre, pour, situation }, offre being an id such as "receptionniste"');
  }
  const example = (x) => x && typeof x.appelant === 'string' && typeof x.reponse === 'string';
  if (cfg.exemples !== undefined && !(Array.isArray(cfg.exemples) && cfg.exemples.every(example))) {
    errors.push('exemples must be a list of { appelant, reponse } texts');
  }
  if (cfg.demonstration !== undefined && typeof cfg.demonstration !== 'boolean') errors.push('demonstration must be true or false');

  // Transfer to the business: a number the agent can dial, and hours the webhook can read. Unreadable
  // hours only warn: the webhook then refuses every transfer, and the calls go on.
  const transfert = cfg.transfert ?? {};
  if (transfert.numero !== undefined && !normalizePhone(transfert.numero)) {
    errors.push(`transfert.numero: "${transfert.numero}" is not a phone number`);
  }
  const hours = transfert.horaires ? parseTransferHours(transfert.horaires) : {};
  if (hours.error) warnings.push(`transfert.horaires: ${hours.error}; until then, no call is transferred`);

  if (providers) {
    const textsCallers = (cfg.confirmation?.sms ?? DEFAULTS.confirmation.sms) !== false;
    if (!providers.email) warnings.push('no email provider key (RESEND_API_KEY): the recap email cannot be sent');
    if (providers.sms && (sms.length > 0 || textsCallers) && sender === null) {
      errors.push('smsSender is required when SMS is on: use the business\'s short name, such as "Dupont"');
    }
    if (!providers.sms && sms.length > 0) {
      warnings.push('notify.sms is set but there is no SMS provider key (BREVO_API_KEY): the owner gets the recap by email only');
    }
  }

  // A field explicitly set to undefined (an unset environment variable) must not erase a default.
  const config = { ...DEFAULTS };
  for (const [key, value] of Object.entries(cfg)) {
    if (value !== undefined) config[key] = value;
  }
  config.voice = cfg.voice || DEFAULTS.voice;
  config.confirmation = { ...DEFAULTS.confirmation, ...(cfg.confirmation || {}) };
  config.notify = { ...notify, email: emails, sms };
  config.smsCountries = smsCountries;
  config.infos = { ...infos, zone: texts(infos.zone) ? infos.zone : [] };

  return { ok: errors.length === 0, errors, warnings, config };
}
