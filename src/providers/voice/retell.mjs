// Retell AI adapter — interface parity with vapi.mjs, to prove the voice layer is swappable.
// Fill these in against https://docs.retellai.com when you need Retell instead of Vapi.

export function isEndOfCall(message) { return message?.event === 'call_analyzed' || message?.event === 'call_ended'; }
export function getToolCalls(message) { return message?.tool_calls ?? []; }
export function extractStructuredData(message) { return message?.call?.call_analysis?.custom_analysis_data ?? {}; }
export function toolResults(results) { return { results }; }
export function verifySecret() { return true; } // Retell signs with an X-Retell-Signature HMAC — implement before production.

export function buildAssistant() {
  throw new Error('Retell adapter not implemented yet. See docs/PROVIDERS.md and https://docs.retellai.com.');
}
