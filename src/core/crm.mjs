// Pure: the end of a call as a CRM receives it (CRM_WEBHOOK_URL), the shape open-pipeline's
// /intake/receptionist reads. Only what a sales follow-up needs: the street address stays here.

export function crmPayload({ callId, endedAt, caller = {}, appointment = null, summary = null }) {
  const c = caller ?? {};
  // The discovery answers (entreprise, activite, offre, situation, appels_manques, echeance), named
  // like open-pipeline's deal fields; absent when the call gave none.
  const answers = c.qualification && Object.keys(c.qualification).length ? { qualification: { ...c.qualification } } : {};
  return {
    ...answers,
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
