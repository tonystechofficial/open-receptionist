// Per-client configuration: one template assistant + one webhook are driven by this object.

const DEFAULTS = {
  language: 'fr',
  recordingEnabled: false, // off by default; see docs/DATA.md
  maxDurationSeconds: 180,
  voice: { provider: 'azure', voiceId: 'fr-FR-DeniseNeural' },
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

  const config = { ...DEFAULTS, ...cfg, voice: cfg.voice || DEFAULTS.voice };
  return { ok: errors.length === 0, errors, config };
}
