// Compares a received secret with the expected one in constant time, so the answer time does not
// reveal how many leading characters of a guess were right. A missing value never matches.
export function safeEqual(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || !expected) return false;
  if (received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
