// The edge rule that cuts off a source flooding the receptionist's endpoints, before the Worker runs.
// Pure: what is sent to Cloudflare's Rulesets API, decided from the zone's current rate-limiting
// ruleset; scripts/cloudflare-rate-limit.mjs does the calls. Checked against Cloudflare's docs on
// 2026-10-24: https://developers.cloudflare.com/waf/rate-limiting-rules/
//  - the Free plan allows one rate-limiting rule, counted per IP, over 10 seconds, blocking for 10;
//  - rules live on a zone, so the Worker must be served from a custom domain, not workers.dev.
// 50 requests in 10 seconds leaves room for Vapi's tool calls during 4 simultaneous calls, and cuts a
// single source sending more than 5 a second.

export const RULE_DESCRIPTION = 'open-receptionist: cut off a source flooding the endpoints';
export const ENDPOINTS = ['/api/vapi', '/api/tools', '/api/call-report', '/api/twilio/voice', '/api/check'];

export function rateLimitRule({ requestsPer10s = 50 } = {}) {
  return {
    description: RULE_DESCRIPTION,
    expression: `(${ENDPOINTS.map((p) => `http.request.uri.path eq "${p}"`).join(' or ')})`,
    action: 'block',
    ratelimit: { characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: requestsPer10s, mitigation_timeout: 10 },
  };
}

/**
 * What to send, given the zone's http_ratelimit entrypoint ruleset (null when it does not exist yet).
 * Another rule in the way is never overwritten unless `replace` is set: the Free plan has room for one.
 * @returns {{method: string, path: string, body: object} | {error: string}}
 */
export function planRateLimit({ zoneId, existing, replace = false }) {
  const rule = rateLimitRule();
  const entrypoint = `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`;
  if (!existing) return { method: 'PUT', path: entrypoint, body: { rules: [rule] } };
  const ours = (existing.rules ?? []).find((r) => r.description === RULE_DESCRIPTION);
  if (ours) return { method: 'PATCH', path: `/zones/${zoneId}/rulesets/${existing.id}/rules/${ours.id}`, body: rule };
  if ((existing.rules ?? []).length && !replace) {
    return { error: `the zone already has a rate-limiting rule ("${existing.rules[0].description}"); run again with --replace to swap it for this one` };
  }
  return { method: 'PUT', path: entrypoint, body: { rules: [rule] } };
}
