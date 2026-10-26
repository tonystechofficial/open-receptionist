// The end of each call, posted to a CRM's webhook with a shared secret in x-pipeline-secret:
// open-pipeline's /intake/receptionist (github.com/tonystechofficial/open-pipeline). No SDK, just fetch.
export function crmWebhook({ url, secret }, fetchImpl = fetch) {
  return async (payload) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pipeline-secret': secret },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`CRM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

/** From CRM_WEBHOOK_URL and CRM_WEBHOOK_SECRET; undefined when no CRM is set. */
export function crmFromEnv(env) {
  if (!env.CRM_WEBHOOK_URL) return undefined;
  if (!env.CRM_WEBHOOK_SECRET) {
    return async () => { throw new Error('CRM_WEBHOOK_SECRET manquant : npx wrangler secret put CRM_WEBHOOK_SECRET'); };
  }
  return crmWebhook({ url: env.CRM_WEBHOOK_URL, secret: env.CRM_WEBHOOK_SECRET });
}
