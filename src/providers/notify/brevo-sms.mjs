// SMS via Brevo transactional SMS. https://developers.brevo.com
// `sender` is the business's short name, 3 to 11 letters or digits. There is no default: a generic
// name such as "Info" or "Accueil" is filtered by French carriers. `to` may be written any way, only
// its digits are sent (international form without the plus, e.g. 33612345678).
// Brevo can refuse calls from unknown IP addresses (Security > Authorised IPs, on by default for new
// accounts) and a Worker has no fixed IP: `check()` runs daily to catch it. See docs/SETUP.md.
export function brevoSms({ apiKey, sender }) {
  return {
    async sendSms({ to, content, sender: override }) {
      const from = override || sender;
      if (!from) throw new Error('brevo sms: no sender name (SMS_SENDER)');
      const recipient = String(to).replace(/[^\d]/g, '');
      const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: from, recipient, content, type: 'transactional' }),
      });
      if (!res.ok) throw new Error(`brevo sms ${res.status}: ${await res.text()}`);
      return res.json();
    },

    /** The account endpoint sits behind the same IP lock as sending. Returns the SMS credits left. */
    async check() {
      const res = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': apiKey, accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`brevo ${res.status}: ${await res.text()}`);
      const account = await res.json();
      const sms = (account.plan ?? []).find((p) => p.type === 'sms');
      return { smsCredits: sms ? Number(sms.credits) : null };
    },
  };
}
