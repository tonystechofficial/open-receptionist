// Per-client configuration: one template assistant + one webhook are driven by this object.
import { normalizePhone, canReceiveSms } from './phone.mjs';

const DEFAULTS = {
  language: 'fr',
  timeZone: 'Europe/Paris',
  recordingEnabled: false, // off by default; see docs/DATA.md
  maxDurationSeconds: 300, // qualifying, choosing a slot and confirming can run past 3 minutes
  voice: { provider: 'azure', voiceId: 'fr-FR-DeniseNeural' },
  confirmation: { sms: true }, // SMS the caller once the appointment is booked
};

// Sender names French carriers filter as generic: Twilio's France guidelines name SMS, Info, Verify,
// Help, Support and Assistance; Infos, Aide and Accueil are their French twins.
const GENERIC_SENDERS = new Set(['SMS', 'INFO', 'INFOS', 'VERIFY', 'HELP', 'SUPPORT', 'ASSISTANCE', 'AIDE', 'ACCUEIL']);

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
  const sms = [];
  for (const raw of Array.isArray(notify.sms) ? notify.sms.filter(Boolean) : []) {
    const number = normalizePhone(raw);
    if (!number) errors.push(`notify.sms: "${raw}" is not a phone number`);
    else if (!canReceiveSms(number)) errors.push(`notify.sms: ${raw} cannot receive SMS, give a mobile (06 or 07)`);
    else sms.push(number);
  }

  // Operators accept an alphanumeric sender of 3 to 11 characters; anything else is rejected at send time.
  const sender = cfg.smsSender == null ? null : String(cfg.smsSender);
  if (sender !== null && !/^[A-Za-z0-9]{3,11}$/.test(sender)) {
    errors.push('smsSender must be 3 to 11 letters or digits');
  } else if (sender !== null && GENERIC_SENDERS.has(sender.toUpperCase())) {
    errors.push(`smsSender "${sender}" is too generic: carriers filter names like Info or Accueil, use the business's short name`);
  }

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

  return { ok: errors.length === 0, errors, warnings, config };
}
