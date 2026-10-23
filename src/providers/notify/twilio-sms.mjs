// SMS via Twilio Programmable Messaging. No SDK, just fetch.
// https://www.twilio.com/docs/messaging/api/message-resource, checked on 2026-10-23.
// A form POST with HTTP Basic auth (Account SID and Auth Token) and no IP allowlist, so it works
// from a Worker. In France `From` is the business's short name: an alphanumeric sender needs no
// registration there, but only paid accounts may use one. `To` goes out in E.164.
export function twilioSms({ accountSid, authToken, sender }) {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
  const authorization = `Basic ${btoa(`${accountSid}:${authToken}`)}`;

  return {
    async sendSms({ to, content, sender: override }) {
      const from = override || sender;
      if (!from) throw new Error('twilio sms: no sender name (SMS_SENDER)');
      const res = await fetch(`${base}/Messages.json`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ To: `+${String(to).replace(/[^\d]/g, '')}`, From: from, Body: content }).toString(),
      });
      if (!res.ok) throw new Error(`twilio sms ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /** Proves the credentials and returns the prepaid balance, which stops all sending at zero. */
    async check() {
      const res = await fetch(`${base}/Balance.json`, { headers: { authorization, accept: 'application/json' } });
      if (!res.ok) throw new Error(`twilio ${res.status}: ${await res.text()}`);
      const account = await res.json();
      return { balance: Number(account.balance), currency: account.currency };
    },
  };
}
