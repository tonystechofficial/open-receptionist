// The edge rule that cuts off a source flooding the receptionist's endpoints, as sent to Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitRule, planRateLimit, RULE_DESCRIPTION } from '../src/providers/hosting/cloudflare-rate-limit.mjs';

test('the rule counts per address on the receptionist paths and blocks within the free plan limits', () => {
  const rule = rateLimitRule();
  assert.equal(rule.description, RULE_DESCRIPTION);
  assert.equal(rule.action, 'block');
  for (const path of ['/api/vapi', '/api/tools', '/api/call-report', '/api/twilio/voice', '/api/check']) {
    assert.ok(rule.expression.includes(`"${path}"`), path);
  }
  assert.deepEqual(rule.ratelimit, { characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: 50, mitigation_timeout: 10 });
});

test('with no rate-limiting ruleset yet, the plan creates it with the rule', () => {
  assert.deepEqual(planRateLimit({ zoneId: 'z1', existing: null }), {
    method: 'PUT', path: '/zones/z1/rulesets/phases/http_ratelimit/entrypoint', body: { rules: [rateLimitRule()] },
  });
});

test('when the rule is already there, the plan updates that rule only', () => {
  const existing = { id: 'rs1', rules: [{ id: 'r9', description: RULE_DESCRIPTION }] };
  assert.deepEqual(planRateLimit({ zoneId: 'z1', existing }), {
    method: 'PATCH', path: '/zones/z1/rulesets/rs1/rules/r9', body: rateLimitRule(),
  });
});

test('another rule in the way is never overwritten without --replace', () => {
  const existing = { id: 'rs1', rules: [{ id: 'r1', description: 'someone else' }] };
  assert.match(planRateLimit({ zoneId: 'z1', existing }).error, /--replace/);
  assert.deepEqual(planRateLimit({ zoneId: 'z1', existing, replace: true }).method, 'PUT');
});
