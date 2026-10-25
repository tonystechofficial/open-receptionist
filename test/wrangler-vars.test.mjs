// The questions `npm run configure` asks, and how the answers land in the [vars] of wrangler.toml.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, readVars, writeVars, normalizeAnswer, checkAnswer } from '../src/providers/hosting/wrangler-vars.mjs';

const TOML = [
  'name = "open-receptionist"',
  '[[d1_databases]]',
  'database_name = "open-receptionist"',
  '',
  '[vars]',
  'CLIENT_COMPANY = "Plomberie Dupont"',
  'CLIENT_TELEPHONE = "05 56 12 34 56"   # given to the caller in the confirmation SMS',
  'NOTIFY_EMAIL = "contact@plomberie-dupont.example"   # required',
  'NOTIFY_SMS = "06 12 34 56 78"         # optional',
  '# ALERT_EMAIL = "you@your-domain.example"  # who gets the daily report',
  '# RETENTION_DAYS = "365"              # 30 to 1825',
  'VAPI_ASSISTANT_ID = ""',
  '',
  '[triggers]',
  'crons = ["0 6 * * *"]',
  '',
].join('\n');

// The template's example values: contacts and ids that must not stay in a real deployment.
const EXAMPLES = {
  CLIENT_COMPANY: 'Plomberie Dupont', CLIENT_TELEPHONE: '05 56 12 34 56', NOTIFY_EMAIL: 'contact@plomberie-dupont.example',
  NOTIFY_SMS: '06 12 34 56 78', ALERT_EMAIL: 'you@your-domain.example', CALCOM_EVENT_TYPE_ID: '123456',
  MAIL_FROM: 'Accueil <accueil@your-domain.example>', CLIENT_TARIFS_URL: 'https://plomberie-dupont.example/tarifs',
};
// A complete, valid set of answers; each test changes one of them.
const GOOD = {
  CLIENT_COMPANY: 'Plomberie Martin', CLIENT_METIER: 'plomberie', CLIENT_HORAIRES: 'du lundi au vendredi',
  CLIENT_TELEPHONE: '05 56 00 00 01', CLIENT_ZONE: '', CLIENT_TARIFS_URL: '', NOTIFY_EMAIL: 'patron@martin.fr',
  NOTIFY_SMS: '', CONFIRM_CALLER_SMS: 'true', CALCOM_EVENT_TYPE_ID: '987654', MAIL_FROM: 'Accueil <accueil@martin.fr>',
  SMS_SENDER: 'Martin', ALERT_EMAIL: '', RETENTION_DAYS: '',
};
const check = (key, value, more = {}) => checkAnswer(key, value, { ...GOOD, ...more, [key]: value }, { examples: EXAMPLES });

test('the [vars] values are read, set and commented out, and nothing from the other sections', () => {
  const { active, commented } = readVars(TOML);
  assert.deepEqual(active, {
    CLIENT_COMPANY: 'Plomberie Dupont', CLIENT_TELEPHONE: '05 56 12 34 56', NOTIFY_EMAIL: 'contact@plomberie-dupont.example',
    NOTIFY_SMS: '06 12 34 56 78', VAPI_ASSISTANT_ID: '',
  });
  assert.deepEqual(commented, { ALERT_EMAIL: 'you@your-domain.example', RETENTION_DAYS: '365' });
});

test('an answer replaces the value and keeps its comment; every other line stays as it was', () => {
  const out = writeVars(TOML, { CLIENT_TELEPHONE: '05 56 00 00 01' });
  assert.equal(out, TOML.replace('CLIENT_TELEPHONE = "05 56 12 34 56"', 'CLIENT_TELEPHONE = "05 56 00 00 01"'));
});

test('Windows line endings survive', () => {
  const crlf = TOML.replace(/\n/g, '\r\n');
  assert.equal(writeVars(crlf, { CLIENT_COMPANY: 'Plomberie Martin' }), crlf.replace('Plomberie Dupont', 'Plomberie Martin'));
});

test('a setting commented out is switched on when answered, and stays off when left empty', () => {
  const out = writeVars(TOML, { ALERT_EMAIL: 'moi@martin.fr', RETENTION_DAYS: '' });
  assert.match(out, /^ALERT_EMAIL = "moi@martin.fr"  # who gets the daily report$/m);
  assert.match(out, /^# RETENTION_DAYS = "365"/m);
});

test('an optional setting answered empty stays in place, empty', () => {
  assert.match(writeVars(TOML, { NOTIFY_SMS: '' }), /^NOTIFY_SMS = ""         # optional$/m);
});

test('quotes and backslashes are escaped and line breaks removed, and the value reads back as typed', () => {
  const out = writeVars(TOML, { CLIENT_COMPANY: 'Chez "Jo" \\ Fils\nSARL' });
  assert.match(out, /^CLIENT_COMPANY = "Chez \\"Jo\\" \\\\ Fils SARL"$/m);
  assert.equal(readVars(out).active.CLIENT_COMPANY, 'Chez "Jo" \\ Fils SARL');
});

test('a setting missing from the file is added to [vars], not to another section', () => {
  const out = writeVars(TOML, { SMS_SENDER: 'Martin' });
  assert.match(out.split('[triggers]')[0], /^SMS_SENDER = "Martin"$/m);
  assert.equal(readVars(out).active.SMS_SENDER, 'Martin');
});

test('yes and no, in English or French, become true and false', () => {
  const q = QUESTIONS.find((x) => x.key === 'CONFIRM_CALLER_SMS');
  for (const yes of ['yes', 'Y', 'oui', 'o', 'true']) assert.equal(normalizeAnswer(q, yes), 'true', yes);
  for (const no of ['no', 'N', 'non', 'false']) assert.equal(normalizeAnswer(q, no), 'false', no);
  assert.ok(check('CONFIRM_CALLER_SMS', normalizeAnswer(q, 'maybe')));
});

test('every question explains itself, and the settings the Worker needs are all asked', () => {
  for (const q of QUESTIONS) assert.ok(q.title && q.help, q.key);
  for (const key of ['CLIENT_COMPANY', 'CLIENT_METIER', 'NOTIFY_EMAIL', 'CALCOM_EVENT_TYPE_ID', 'MAIL_FROM', 'SMS_SENDER']) {
    assert.ok(QUESTIONS.some((q) => q.key === key), key);
  }
});

test("the Worker's own rules refuse a bad answer, with their reason", () => {
  assert.match(check('SMS_SENDER', 'Accueil'), /too generic/);
  assert.equal(check('SMS_SENDER', 'Martin'), null);
  assert.match(check('NOTIFY_SMS', '05 56 00 00 01'), /cannot receive SMS/);
  assert.equal(check('NOTIFY_SMS', '06 00 00 00 02'), null);
  assert.match(check('CLIENT_TARIFS_URL', 'http://martin.fr/tarifs'), /https/);
  assert.match(check('SMS_SENDER', '', { CONFIRM_CALLER_SMS: 'true' }), /required when SMS is on/);
  assert.equal(check('SMS_SENDER', '', { CONFIRM_CALLER_SMS: 'false', NOTIFY_SMS: '' }), null);
});

test('a required setting cannot be left empty; an optional one can', () => {
  for (const key of ['CLIENT_COMPANY', 'CLIENT_METIER', 'NOTIFY_EMAIL', 'CALCOM_EVENT_TYPE_ID', 'MAIL_FROM']) {
    assert.ok(check(key, ''), key);
  }
  for (const key of ['CLIENT_HORAIRES', 'CLIENT_ZONE', 'CLIENT_TARIFS_URL', 'NOTIFY_SMS', 'ALERT_EMAIL', 'RETENTION_DAYS']) {
    assert.equal(check(key, ''), null, key);
  }
});

test("the template's example contacts and ids are refused: left in place, they would get the recaps", () => {
  for (const key of ['NOTIFY_EMAIL', 'NOTIFY_SMS', 'CLIENT_TELEPHONE', 'CALCOM_EVENT_TYPE_ID', 'MAIL_FROM', 'CLIENT_TARIFS_URL', 'ALERT_EMAIL']) {
    assert.match(check(key, EXAMPLES[key]), /example/, key);
  }
  assert.equal(check('CLIENT_COMPANY', 'Plomberie Dupont'), null); // a made-up name is fine for a demo
});

test('formats the Worker does not check are checked here', () => {
  assert.ok(check('NOTIFY_EMAIL', 'patron@martin'));
  assert.ok(check('NOTIFY_EMAIL', 'patron@martin.fr, pas-un-email'));
  assert.equal(check('NOTIFY_EMAIL', 'patron@martin.fr, compta@martin.fr'), null);
  assert.ok(check('ALERT_EMAIL', 'moi'));
  assert.ok(check('MAIL_FROM', 'accueil'));
  assert.equal(check('MAIL_FROM', 'accueil@martin.fr'), null);
  assert.ok(check('CALCOM_EVENT_TYPE_ID', 'abc'));
  assert.ok(check('CLIENT_TELEPHONE', '12'));
  assert.ok(check('RETENTION_DAYS', '20'));
  assert.equal(check('RETENTION_DAYS', '730'), null);
});

test('the transfer hours are checked as the Worker reads them, and may stay empty', () => {
  assert.match(check('TRANSFER_HOURS', 'tous les jours'), /lun-ven 8h-18h/);
  assert.equal(check('TRANSFER_HOURS', 'lun-ven 8h-18h; sam 9h-12h'), null);
  assert.equal(check('TRANSFER_HOURS', ''), null);
});
