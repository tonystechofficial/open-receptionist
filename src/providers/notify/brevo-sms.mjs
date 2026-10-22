// SMS recap via Brevo transactional SMS. https://developers.brevo.com
// `sender` is max 11 alphanumeric chars; `to` is an international number WITHOUT the plus (e.g. 33612345678).
export function brevoSms({ apiKey, sender = 'Accueil' }) {
  return {
    async sendSms({ to, content }) {
      const recipient = String(to).replace(/[^\d]/g, '');
      const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender, recipient, content, type: 'transactional' }),
      });
      if (!res.ok) throw new Error(`brevo sms ${res.status}: ${await res.text()}`);
      return res.json();
    },
  };
}
