// Twilio in front of Vapi (method 1): the number's Voice webhook points at the Worker, which screens
// each incoming call before anything answers it. Checked against Twilio's docs on 2026-10-24:
//  - <Reject> refuses a call "without being billed"   https://www.twilio.com/docs/voice/twiml/reject
//  - X-Twilio-Signature is base64(HMAC-SHA1(auth token, URL + each POST field name and value, sorted
//    by name))   https://www.twilio.com/docs/usage/security#validating-requests
// An allowed call is redirected to the webhook Vapi itself sets on an imported Twilio number
// (https://api.vapi.ai/twilio/inbound_call, as Vapi support gives it), so Vapi answers as usual.

export const VAPI_TWILIO_INBOUND = 'https://api.vapi.ai/twilio/inbound_call';

const encoder = new TextEncoder();

/** True only when the request carries a valid signature for this URL, fields and account token. */
export async function verifyTwilioSignature({ url, params, signature, authToken }) {
  if (!signature || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', encoder.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  return sameText(btoa(String.fromCharCode(...mac)), signature);
}

/** Compares in constant time, so the check does not leak how much of a forged signature was right. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const response = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

/** Hand the call to Vapi, which answers with the assistant attached to the number. */
export function twimlForward(url = VAPI_TWILIO_INBOUND) {
  return response(`<Redirect method="POST">${escapeXml(url)}</Redirect>`);
}

/** Refuse the call without answering it: neither Twilio nor Vapi bills it. */
export function twimlReject() {
  return response('<Reject reason="rejected"/>');
}

/** Answer, say one sentence, hang up: a few seconds at Twilio's rate, and Vapi never involved. */
export function twimlSayAndHangUp(text) {
  return response(`<Say language="fr-FR">${escapeXml(text)}</Say><Hangup/>`);
}
