// Per-client configuration: one template assistant + one webhook are driven by this object.

const DEFAULTS = {
  language: 'fr',
  timeZone: 'Europe/Paris',
  recordingEnabled: false, // off by default; see docs/DATA.md
  maxDurationSeconds: 300, // qualifying, choosing a slot and confirming can run past 3 minutes
  voice: { provider: 'azure', voiceId: 'fr-FR-DeniseNeural' },
  confirmation: { sms: true }, // SMS the caller once the appointment is booked
};

/**
 * @param {object} cfg
 * @returns {{ok:boolean, errors:string[], config:object}}
 */
export function validateClientConfig(cfg = {}) {
  const errors = [];

  if (!cfg.company || !String(cfg.company).trim()) errors.push('company is required');
  if (!cfg.metier || !String(cfg.metier).trim()) errors.push('metier is required');
  if (!cfg.calendar || !cfg.calendar.provider || !cfg.calendar.id) {
    errors.push('calendar.provider and calendar.id are required');
  }

  const notify = cfg.notify || {};
  const hasEmail = Array.isArray(notify.email) && notify.email.length > 0;
  const hasSms = Array.isArray(notify.sms) && notify.sms.length > 0;
  if (!hasEmail && !hasSms) {
    errors.push('at least one notify channel (email or sms) is required');
  }

  // Operators accept an alphanumeric sender of 3 to 11 characters; anything else is rejected at send time.
  if (cfg.smsSender != null && !/^[A-Za-z0-9]{3,11}$/.test(String(cfg.smsSender))) {
    errors.push('smsSender must be 3 to 11 letters or digits');
  }

  // A field explicitly set to undefined (an unset environment variable) must not erase a default.
  const config = { ...DEFAULTS };
  for (const [key, value] of Object.entries(cfg)) {
    if (value !== undefined) config[key] = value;
  }
  config.voice = cfg.voice || DEFAULTS.voice;
  config.confirmation = { ...DEFAULTS.confirmation, ...(cfg.confirmation || {}) };

  return { ok: errors.length === 0, errors, config };
}
