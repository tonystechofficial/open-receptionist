import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryProblems, alertEmail, creditProblem, callProblems, screeningProblems, floodAlertEmail } from '../src/core/alerts.mjs';

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

test('a call cut at the time cap is reported', () => {
  const problems = callProblems([{ callId: 'call_5', caller, endedAt: AT, endedReason: 'exceeded-max-duration' }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /call_5/);
  assert.match(problems[0], /durée maximale/);
});

test('a number calling five times or more is reported once, with the count', () => {
  const calls = Array.from({ length: 6 }, (_, i) => ({ callId: `c${i}`, caller, endedAt: AT, endedReason: 'customer-ended-call' }));
  const problems = callProblems(calls);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /06 12 34 56 78/);
  assert.match(problems[0], /6 fois/);
});

test('ordinary calls are not problems', () => {
  const calls = [
    { callId: 'a', caller, endedAt: AT, endedReason: 'customer-ended-call' },
    { callId: 'b', caller, endedAt: AT, endedReason: 'assistant-ended-call' },
    { callId: 'c', caller: null, endedAt: AT, endedReason: 'silence-timed-out' },
  ];
  assert.deepEqual(callProblems(calls), []);
});

test('refused calls are summed up per number and reason, one line each', () => {
  const refused = (number, reason) => ({ number, at: AT, decision: 'refused', reason, via: 'twilio' });
  const problems = screeningProblems([
    refused('+33612345678', 'number-hour'), refused('+33612345678', 'number-hour'), refused('+33612345678', 'number-hour'),
    refused(null, 'anonymous'), refused(null, 'anonymous'),
    { number: '+33700000000', at: AT, decision: 'allowed', reason: null, via: 'twilio' },
  ]);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.ok(problems.some((p) => p.includes('06 12 34 56 78') && p.includes('3')), problems.join('\n'));
  assert.ok(problems.some((p) => /masqu/.test(p) && p.includes('2')), problems.join('\n'));
});

test('a call that could not be routed for lack of VAPI_ASSISTANT_ID is a configuration problem', () => {
  const problems = screeningProblems([{ number: '+33612345678', at: AT, decision: 'refused', reason: 'no-assistant', via: 'vapi' }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /VAPI_ASSISTANT_ID/);
});

test('the flood alert names the business, the kind of wave and the time, and says callers still hear 112', () => {
  const mail = floodAlertEmail({ company: 'Plomberie Dupont', reason: 'total', at: new Date('2026-10-24T12:05:00Z') });
  assert.match(mail.subject, /Plomberie Dupont/);
  assert.match(mail.subject, /vague/i);
  assert.match(mail.text, /14:05/);
  assert.match(mail.text, /112/);
  assert.match(mail.text, /BLOCKED_NUMBERS/);
  assert.match(floodAlertEmail({ company: 'D', reason: 'anonymous', at: new Date() }).text, /masqu/);
});
