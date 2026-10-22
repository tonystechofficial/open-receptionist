// Email recap via Resend. No SDK, just fetch. https://resend.com/docs
export function resend({ apiKey, from }) {
  return {
    async sendEmail({ to, subject, html, text }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, text }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
      return res.json();
    },
  };
}
