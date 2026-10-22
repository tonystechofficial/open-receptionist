// Vercel function: the single webhook Vapi posts to (tool calls and end-of-call reports).
import { handleVapiMessage } from '../src/server/handlers.mjs';
import { fallbackResponse } from '../src/server/fallback.mjs';
import { buildDeps } from '../src/server/deps.mjs';
import * as vapi from '../src/providers/voice/vapi.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!vapi.verifySecret(req.headers, process.env.WEBHOOK_SECRET)) return res.status(401).json({ error: 'bad secret' });
  const message = req.body?.message ?? req.body;
  try {
    res.status(200).json(await handleVapiMessage(message, await buildDeps()));
  } catch (error) {
    console.error('[open-receptionist]', error);
    res.status(200).json(fallbackResponse(message)); // Vapi ignores tool results on non-200 answers
  }
}
