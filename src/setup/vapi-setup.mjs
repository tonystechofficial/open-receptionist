// npm run vapi:setup, pure parts: the local secrets file (.env.local, ignored by git) it reads and
// updates, and the Vapi credential that lets the Worker recognise Vapi. The credential's shape is
// Vapi's CreateCustomCredentialDTO (OpenAPI spec at https://api.vapi.ai/api-json, read 2026-10-25).

const LINE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;
const unquote = (v) => v.trim().replace(/^"(.*)"$/, '$1');

/** KEY=value lines; comments, blank lines and anything else are skipped. */
export function readEnv(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(LINE);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

/** The file with these values: each set in place, or added at the end. Everything else stays. */
export function writeEnv(text, values) {
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  const pending = new Map(Object.entries(values));
  const lines = String(text).split(/\r?\n/).map((line) => {
    const m = !/^\s*#/.test(line) && line.match(LINE);
    if (!m || !pending.has(m[1])) return line;
    const value = pending.get(m[1]);
    pending.delete(m[1]);
    return `${m[1]}=${value}`;
  });
  if (lines.at(-1) === '') lines.pop();
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  return lines.join(eol) + eol;
}

/** Vapi sends the token as the header X-Vapi-Secret, bare, as the Worker expects it. */
export function credentialBody(secret) {
  return {
    provider: 'custom-credential',
    name: 'open-receptionist webhook',
    authenticationPlan: { type: 'bearer', token: secret, headerName: 'X-Vapi-Secret', bearerPrefixEnabled: false },
  };
}
