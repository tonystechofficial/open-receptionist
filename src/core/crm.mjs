// Pure: the end of a call as a CRM receives it (CRM_WEBHOOK_URL), the shape open-pipeline's
// /intake/receptionist reads. Only what a sales follow-up needs: the street address stays here.

export function crmPayload({ callId, endedAt, caller = {}, appointment = null, summary = null }) {
  const c = caller ?? {};
  return {
    callId,
    endedAt,
    status: appointment ? 'rdv' : 'a_rappeler',
    caller: {
      nom: c.nom ?? null,
      telephone: c.telephone ?? null,
      email: c.email ?? null,
      besoin: c.besoin ?? null,
      urgence: c.urgence ?? null,
      ville: c.ville ?? null,
    },
    appointment: appointment ? { at: appointment.at, label: appointment.label ?? null } : null,
    summary: summary ?? null,
  };
}
