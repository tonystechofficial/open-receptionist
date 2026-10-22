// Retell AI adapter — interface parity with vapi.mjs, to keep the voice layer swappable.
// Fill these in against https://docs.retellai.com when you need Retell instead of Vapi.
// Because the caller's details travel through our own tools (noter_demande, prendre_rdv),
// switching platform only means mapping these few readers, not rewriting the flows.

export function isEndOfCall(message) { return message?.event === 'call_analyzed' || message?.event === 'call_ended'; }
export function getToolCalls(message) { return message?.tool_calls ?? []; }
export function getCallId(message) { return message?.call?.call_id ?? null; }
export function getCallerNumber(message) { return message?.call?.from_number ?? null; }
export function getAnalysis(message) {
  const a = message?.call?.call_analysis ?? {};
  return { summary: a.call_summary ?? null, structuredData: a.custom_analysis_data ?? null };
}
export function toolResults(results) { return { results }; }
export function verifySecret() { return true; } // Retell signs with an X-Retell-Signature HMAC — implement before production.

export function buildAssistant() {
  throw new Error('Retell adapter not implemented yet. See docs/PROVIDERS.md and https://docs.retellai.com.');
}
