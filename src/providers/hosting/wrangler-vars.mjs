// What `npm run configure` asks, and how the answers land in the [vars] of wrangler.toml. Pure:
// scripts/configure.mjs asks the questions and writes the file. Each answer is checked with the rules
// the Worker applies when it starts (validateClientConfig), plus the formats those rules leave out, and
// the template's example contacts are refused: left in place, they would receive the recaps.
import { validateClientConfig, configFromVars } from '../../core/config.mjs';
import { normalizePhone } from '../../core/phone.mjs';
import { retentionDays } from '../../core/retention.mjs';

const EMAIL = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/;
const SENDER = /^([^<>"]*<[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+>|[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+)$/;
const emails = (v) => (v.split(',').map((e) => e.trim()).every((e) => EMAIL.test(e)) ? null : 'give email addresses, comma-separated, such as patron@entreprise.fr');

/**
 * In the order they are asked. `required`: an empty answer is refused. `contact`: the template's example
 * value is refused. `fields`: the validateClientConfig errors that belong to this answer. `check`: a
 * format the Worker's rules leave out. TIME_ZONE, VAPI_ASSISTANT_ID (step 4.3) and the screening limits
 * are not asked: their defaults hold.
 */
export const QUESTIONS = [
  {
    key: 'CLIENT_COMPANY', required: true, fields: ['company'], title: 'Business name',
    help: 'What the receptionist says when it answers: « Bonjour, vous êtes bien chez … ». A made-up name is fine for a demo.',
    example: 'Plomberie Martin',
  },
  {
    key: 'CLIENT_METIER', required: true, fields: ['metier'], title: 'Trade',
    help: 'In French, as in « une entreprise de … ».',
    example: 'plomberie',
  },
  {
    key: 'CLIENT_HORAIRES', title: 'Opening hours',
    help: 'In words, as the receptionist reads them out. Empty: it gives no hours.',
    example: 'du lundi au vendredi, de 8 h à 18 h',
  },
  {
    key: 'CLIENT_TELEPHONE', contact: true, title: 'Number callers ring to change an appointment',
    help: 'The confirmation SMS gives it. A line the business answers.',
    example: '05 56 00 00 00',
    check: (v) => (normalizePhone(v) ? null : 'give a phone number, such as 05 56 00 00 00'),
  },
  {
    key: 'CLIENT_ZONE', fields: ['infos.zone'], title: 'Towns served',
    help: 'Comma-separated: nobody gets booked elsewhere. Empty: everywhere, the right choice for a demo people test from anywhere. Keep the same list as infos.zone in config/client.json.',
    example: 'Bordeaux, Mérignac, Pessac',
  },
  {
    key: 'CLIENT_TARIFS_URL', contact: true, fields: ['infos.tarifsUrl'], title: 'Page with the published rates',
    help: 'An https:// address, linked at the end of the confirmation SMS. Empty: no link.',
    example: 'https://www.entreprise.fr/tarifs',
  },
  {
    key: 'NOTIFY_EMAIL', required: true, contact: true, fields: ['notify.email'], title: 'Who gets the recap of every call',
    help: 'One or more emails, comma-separated. Required: the email recap is the record of every call. For a demo, yours.',
    example: 'patron@entreprise.fr',
    check: emails,
  },
  {
    key: 'NOTIFY_SMS', contact: true, fields: ['notify.sms'], title: 'Mobiles that also get a one-line SMS recap',
    help: 'Mobile numbers (06, 07), comma-separated, on top of the email. Empty: email only.',
    example: '06 00 00 00 00',
  },
  {
    key: 'CONFIRM_CALLER_SMS', yesNo: true, title: 'Text callers a confirmation after a booking?',
    help: 'yes or no. Needs a Twilio account out of its trial: a trial only texts the numbers you verified.',
    example: 'yes',
    check: (v) => (v === 'true' || v === 'false' ? null : 'answer yes or no'),
  },
  {
    key: 'CALCOM_EVENT_TYPE_ID', required: true, contact: true, fields: ['calendar'], title: 'Cal.com event type',
    help: "The number at the end of the event type's address in Cal.com: …/event-types/1234567.",
    example: '1234567',
    check: (v) => (/^\d+$/.test(v) ? null : 'give the number only, such as 1234567'),
  },
  {
    key: 'MAIL_FROM', required: true, contact: true, title: 'Sender of the recap emails',
    help: 'An address on the domain you verified in Resend, with a name in front if you like.',
    example: 'Accueil <accueil@entreprise.fr>',
    check: (v) => (SENDER.test(v) ? null : 'give an address such as accueil@entreprise.fr, or Accueil <accueil@entreprise.fr>'),
  },
  {
    key: 'SMS_SENDER', fields: ['smsSender'], title: 'Name the SMS come from',
    help: "The business's short name: 3 to 11 letters or digits, at least one letter, never a generic word such as Info or Accueil. Required as soon as anything is texted.",
    example: 'Martin',
  },
  {
    key: 'ALERT_EMAIL', contact: true, title: 'Who gets the daily report and the alerts',
    help: 'Usually you, the operator. Empty: the first recap email.',
    example: 'vous@votre-domaine.fr',
    check: (v) => (EMAIL.test(v) ? null : 'give one email address'),
  },
  {
    key: 'RETENTION_DAYS', title: 'How long call records are kept',
    help: 'In days, from 30 to 1825; older records are deleted every morning. Empty: 365.',
    example: '365',
    check: (v) => (retentionDays(v).warning ? 'give a whole number of days from 30 to 1825' : null),
  },
];

/** A typed answer, ready to check: one line, trimmed; yes and no (or oui and non) become true and false. */
export function normalizeAnswer(question, raw) {
  const value = String(raw ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!question.yesNo) return value;
  if (/^(y|yes|o|oui|true)$/i.test(value)) return 'true';
  if (/^(n|no|non|false)$/i.test(value)) return 'false';
  return value;
}

/**
 * Why this answer cannot be kept, or null. `answers` holds every value so far, this one included, for
 * the rules that span several settings (an SMS sender is required as soon as anything is texted).
 */
export function checkAnswer(key, value, answers, { examples = {} } = {}) {
  const q = QUESTIONS.find((x) => x.key === key);
  if (!q) return null;
  if (!value) {
    if (q.required) return 'this one is required';
  } else {
    if (q.contact && examples[key] && value === examples[key]) {
      return "this is the template's example: give the business's own, or the example would receive the recaps";
    }
    const own = q.check?.(value);
    if (own) return own;
  }
  // The Worker's own rules, kept to the errors about this answer.
  const { errors } = validateClientConfig(configFromVars({ ...answers, [key]: value }), { providers: { email: true, sms: true } });
  return errors.find((e) => (q.fields ?? []).some((f) => e.startsWith(f))) ?? null;
}

const SECTION = /^\s*\[/;
const VARS_SECTION = /^\s*\[vars\]\s*$/;
const VAR_LINE = /^(\s*)(#\s*)?([A-Z][A-Z0-9_]*)(\s*=\s*)"((?:[^"\\]|\\.)*)"(.*)$/;
const escape = (v) => String(v).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const unescape = (v) => v.replace(/\\(["\\])/g, '$1');

/** The settings of the [vars] section: those set, and those commented out (switched off). */
export function readVars(toml) {
  const active = {};
  const commented = {};
  let inVars = false;
  for (const line of toml.split(/\r?\n/)) {
    if (SECTION.test(line)) {
      inVars = VARS_SECTION.test(line);
      continue;
    }
    const m = inVars && line.match(VAR_LINE);
    if (m) (m[2] ? commented : active)[m[3]] = unescape(m[5]);
  }
  return { active, commented };
}

/**
 * The file with these answers in [vars]. A value is replaced in its own line, comment kept; a setting
 * commented out is switched on when answered and stays off when the answer is empty; a setting missing
 * from the file goes after the last one of [vars]. Every other line, and the line endings, stay as they are.
 */
export function writeVars(toml, answers) {
  const parts = toml.split(/(\r?\n)/); // lines at even indexes, their line endings at odd ones
  const eol = toml.includes('\r\n') ? '\r\n' : '\n';
  const pending = new Map(Object.entries(answers));
  let inVars = false;
  let anchor = -1; // the last line of [vars] seen: its header, then its last setting
  for (let i = 0; i < parts.length; i += 2) {
    if (SECTION.test(parts[i])) {
      inVars = VARS_SECTION.test(parts[i]);
      if (inVars) anchor = i;
      continue;
    }
    const m = inVars && parts[i].match(VAR_LINE);
    if (!m) continue;
    anchor = i;
    const [, indent, hash, key, eq, , rest] = m;
    if (!pending.has(key)) continue;
    const value = pending.get(key);
    pending.delete(key);
    if (hash && value === '') continue;
    parts[i] = `${indent}${key}${eq}"${escape(value)}"${rest}`;
  }
  const added = [...pending].filter(([, v]) => v !== '').map(([k, v]) => `${k} = "${escape(v)}"`);
  if (!added.length) return parts.join('');
  if (anchor < 0) return `${toml}${toml.endsWith('\n') ? '' : eol}[vars]${eol}${added.join(eol)}${eol}`;
  parts.splice(anchor + 1, 0, ...added.flatMap((line) => [eol, line]));
  return parts.join('');
}
