import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryProblems, alertEmail, creditProblem } from '../src/core/alerts.mjs';

const AT = '2026-10-23T08:00:00.000Z';
const caller = { nom: 'Jean Dupont', telephone: '+33612345678' };

test('a failed caller SMS, a failed recap email and a failed owner SMS are each reported', () => {
  const problems = deliveryProblems([{
    callId: 'call_1',
    caller,
    endedAt: AT,
    recapSentAt: null,
    deliveries: {
      callerSms: { status: 'failed', to: '+33612345678', reason: 'brevo sms 401: unrecognised IP address', at: AT },
      recap: {
        email: { status: 'failed', reason: 'resend 500', at: AT },
        sms: [{ status: 'failed', to: '+33600000000', reason: 'brevo sms 401', at: AT }],
      },
    },
  }]);
  assert.equal(problems.length, 3, problems.join('\n'));
  assert.ok(problems.every((p) => p.includes('Jean Dupont') && p.includes('call_1')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('06 12 34 56 78') && p.includes('401')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('email') && p.includes('resend 500')), problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('06 00 00 00 00')), problems.join('\n'));
});

test('sent and skipped deliveries are not problems', () => {
  const problems = deliveryProblems([{
    callId: 'call_2',
    caller,
    endedAt: AT,
    recapSentAt: AT,
    deliveries: {
      callerSms: { status: 'skipped', reason: 'numéro fixe', at: AT },
      recap: { email: { status: 'sent', at: AT }, sms: [{ status: 'sent', to: '+33600000000', at: AT }] },
    },
  }]);
  assert.deepEqual(problems, []);
});

test('a call that ended without any recap attempt is reported', () => {
  const problems = deliveryProblems([{ callId: 'call_3', caller: null, endedAt: AT, recapSentAt: null, deliveries: null }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /call_3/);
  assert.match(problems[0], /récapitulatif/);
});

test('a call still in progress is not a problem', () => {
  assert.deepEqual(deliveryProblems([{ callId: 'call_4', caller, endedAt: null, recapSentAt: null, deliveries: null }]), []);
});

test('the alert email names the business, counts the problems and lists them', () => {
  const mail = alertEmail({ company: 'Plomberie Dupont', problems: ['un', 'deux'] });
  assert.match(mail.subject, /Plomberie Dupont/);
  assert.match(mail.subject, /2 problèmes/);
  assert.match(mail.text, /un\n.*deux|un[\s\S]*deux/);
  assert.match(mail.html, /<li>un<\/li>/);
});

test('the alert email escapes what it quotes', () => {
  const mail = alertEmail({ company: 'Dupont', problems: ['<script>'] });
  assert.match(mail.subject, /1 problème\b/);
  assert.doesNotMatch(mail.html, /<script>/);
});

test('Brevo: fewer than 20 SMS credits left is a problem', () => {
  assert.match(creditProblem('brevo', { smsCredits: 3 }), /crédits SMS[^\n]*\b3\b/i);
  assert.equal(creditProblem('brevo', { smsCredits: 120 }), null);
  assert.equal(creditProblem('brevo', { smsCredits: null }), null);
});

test('Twilio: a balance under 5 means the automatic recharge is not working', () => {
  const p = creditProblem('twilio', { balance: 3.2, currency: 'USD' });
  assert.match(p, /3\.20 USD/);
  assert.match(p, /recharge/);
  assert.equal(creditProblem('twilio', { balance: 25, currency: 'USD' }), null);
});
