// Twilio in front of Vapi: the request signature, and the TwiML that rejects, answers or forwards a call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTwilioSignature, twimlForward, twimlReject, twimlSayAndHangUp, VAPI_TWILIO_INBOUND } from '../src/providers/telephony/twilio-voice.mjs';

const URL_ = 'https://w.example/api/twilio/voice';
const TOKEN = 'test-auth-token';
const PARAMS = { CallSid: 'CA_test_call', From: '+33612345678', To: '+33556123456', AccountSid: 'AC_test_account' };

// Twilio's documented scheme: the URL, then each POST field name and value sorted by name, HMAC-SHA1, base64.
function sign(url, params, token = TOKEN) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', token).update(data).digest('base64');
}

test('a request signed with the account token is accepted', async () => {
  assert.equal(await verifyTwilioSignature({ url: URL_, params: PARAMS, signature: sign(URL_, PARAMS), authToken: TOKEN }), true);
});

test('a forged, missing or altered signature is refused', async () => {
  assert.equal(await verifyTwilioSignature({ url: URL_, params: PARAMS, signature: sign(URL_, PARAMS, 'other-token'), authToken: TOKEN }), false);
  assert.equal(await verifyTwilioSignature({ url: URL_, params: PARAMS, signature: null, authToken: TOKEN }), false);
  const altered = { ...PARAMS, From: '+33700000000' };
  assert.equal(await verifyTwilioSignature({ url: URL_, params: altered, signature: sign(URL_, PARAMS), authToken: TOKEN }), false);
  assert.equal(await verifyTwilioSignature({ url: URL_, params: PARAMS, signature: sign(URL_, PARAMS), authToken: undefined }), false);
});

test('an allowed call is handed to Vapi\'s own Twilio webhook', () => {
  const xml = twimlForward();
  assert.match(xml, /^<\?xml/);
  assert.ok(xml.includes(`<Redirect method="POST">${VAPI_TWILIO_INBOUND}</Redirect>`), xml);
  assert.equal(VAPI_TWILIO_INBOUND, 'https://api.vapi.ai/twilio/inbound_call');
});

test('a blocked call is rejected without being answered', () => {
  assert.ok(twimlReject().includes('<Reject reason="rejected"/>'));
});

test('a limited caller hears one French sentence, safely escaped, then the line closes', () => {
  const xml = twimlSayAndHangUp('Plomberie <Dupont> & fils : rappelez plus tard.');
  assert.ok(xml.includes('<Say language="fr-FR">Plomberie &lt;Dupont&gt; &amp; fils : rappelez plus tard.</Say><Hangup/>'), xml);
});
