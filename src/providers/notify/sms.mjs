// Which SMS provider a deployment uses follows from the keys it was given: Twilio when both its
// Account SID and Auth Token are set, otherwise Brevo when its key is set, otherwise none. Both
// adapters expose sendSms({ to, content, sender }) and check().
import { twilioSms } from './twilio-sms.mjs';
import { brevoSms } from './brevo-sms.mjs';

export function smsProvider(env, sender) {
  const warnings = [];
  const twilio = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
  if (!twilio && (env.TWILIO_ACCOUNT_SID || env.TWILIO_AUTH_TOKEN)) {
    warnings.push('Twilio needs both TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN: it is not used');
  }
  if (twilio && env.BREVO_API_KEY) {
    warnings.push('both Twilio and Brevo keys are set: Twilio sends the SMS, remove BREVO_API_KEY');
  }
  if (twilio) {
    return { name: 'twilio', adapter: twilioSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, sender }), warnings };
  }
  if (env.BREVO_API_KEY) return { name: 'brevo', adapter: brevoSms({ apiKey: env.BREVO_API_KEY, sender }), warnings };
  return { name: null, adapter: null, warnings };
}
