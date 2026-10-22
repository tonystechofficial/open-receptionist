// Vercel function: receives Vapi `tool-calls` (verifier_dispos, prendre_rdv).
import { handleToolCall } from '../src/server/handlers.mjs';
import { buildDeps } from '../src/server/deps.mjs';
import * as vapi from '../src/providers/voice/vapi.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!vapi.verifySecret(req.headers, process.env.WEBHOOK_SECRET)) return res.status(401).json({ error: 'bad secret' });
  const message = req.body?.message ?? req.body;
  try {
    const out = await handleToolCall(message, await buildDeps());
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
}
