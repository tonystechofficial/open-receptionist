// Puts the edge rule that cuts off a source flooding the receptionist's endpoints (docs/SETUP.md,
// step 3.6). Prints what it would change; changes nothing without --apply.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... node scripts/cloudflare-rate-limit.mjs [--apply] [--replace]
//
// The token needs the "Zone WAF: Edit" permission on the zone that serves the Worker's custom domain.
import { planRateLimit } from '../src/providers/hosting/cloudflare-rate-limit.mjs';

const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;
const apply = process.argv.includes('--apply');
const replace = process.argv.includes('--replace');
if (!token || !zoneId) {
  console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are required (the zone of the custom domain).');
  process.exit(1);
}

async function cloudflare(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const current = await cloudflare('GET', `/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`);
if (current.status !== 200 && current.status !== 404) {
  console.error(`Cloudflare answered ${current.status}:`, JSON.stringify(current.data.errors ?? current.data));
  process.exit(1);
}
const plan = planRateLimit({ zoneId, existing: current.status === 200 ? current.data.result : null, replace });
if (plan.error) {
  console.error(plan.error);
  process.exit(1);
}

console.log(`${plan.method} ${plan.path}`);
console.log(JSON.stringify(plan.body, null, 2));
if (!apply) {
  console.log('\nNothing changed. Run again with --apply to put this rule.');
  process.exit(0);
}
const done = await cloudflare(plan.method, plan.path, plan.body);
if (done.status >= 300 || done.data.success === false) {
  console.error(`Cloudflare refused (${done.status}):`, JSON.stringify(done.data.errors ?? done.data));
  process.exit(1);
}
console.log('Rule in place.');
