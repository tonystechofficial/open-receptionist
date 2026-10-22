// SMS via Brevo transactional SMS. https://developers.brevo.com
// `sender` is 3 to 11 letters or digits; `to` may be written any way, only its digits are sent
// (international form without the plus, e.g. 33612345678).
export function brevoSms({ apiKey, sender = 'Accueil' }) {
  return {
    async sendSms({ to, content, sender: override }) {
      const recipient = String(to).replace(/[^\d]/g, '');
      const res = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: override || sender, recipient, content, type: 'transactional' }),
      });
      if (!res.ok) throw new Error(`brevo sms ${res.status}: ${await res.text()}`);
      return res.json();
    },
  };
}
