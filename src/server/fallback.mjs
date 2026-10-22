// What the webhook answers when something below it breaks (bad configuration, store down...).
// Vapi only reads tool results from an HTTP 200, so a failure still returns 200 with one result
// per tool call telling the agent to promise a call-back, instead of leaving the caller in silence.
export const FALLBACK_LINE =
  "Je n'arrive pas à traiter cette demande pour le moment. Dis à l'appelant que l'entreprise le rappelle, et vérifie son numéro.";

export function fallbackResponse(message) {
  if (message?.type !== 'tool-calls') return { ok: false };
  const calls = message.toolCallList ?? message.toolCalls ?? [];
  return {
    results: calls.map((c) => ({ name: c.function?.name ?? c.name, toolCallId: c.id ?? c.toolCallId, result: FALLBACK_LINE })),
  };
}
