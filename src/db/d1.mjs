// Cloudflare D1 store adapter. Same interface as src/db/store.mjs (see the comment there), backed
// by migrations/0001_init.sql. D1 is a Workers binding, so the database handle is passed in.
// D1 rejects `undefined` as a bound value, so every optional value goes through `v()`.

const v = (x) => (x === undefined ? null : x);

export function d1Store(db) {
  async function getCall(callId) {
    const row = await db.prepare('SELECT * FROM calls WHERE call_id = ?').bind(callId).first();
    return row ? callFromRow(row) : null;
  }

  return {
    getCall,

    async upsertCall(callId, patch) {
      const now = new Date().toISOString();
      const previous = await getCall(callId);
      const next = { ...(previous ?? { callId, createdAt: now }), ...patch, callId, updatedAt: now };
      const c = next.caller ?? {};
      await db
        .prepare(
          `INSERT INTO calls (call_id, nom, besoin, urgence, telephone, email, complet, status, urgent, offered,
             summary, note, ended_at, ended_reason, recap_sent_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(call_id) DO UPDATE SET
             nom = excluded.nom, besoin = excluded.besoin, urgence = excluded.urgence,
             telephone = excluded.telephone, email = excluded.email, complet = excluded.complet,
             status = excluded.status, urgent = excluded.urgent, offered = excluded.offered,
             summary = excluded.summary, note = excluded.note, ended_at = excluded.ended_at,
             ended_reason = excluded.ended_reason, recap_sent_at = excluded.recap_sent_at,
             updated_at = excluded.updated_at`,
        )
        .bind(
          callId, v(c.nom), v(c.besoin), v(c.urgence), v(c.telephone), v(c.email), c.complet ? 1 : 0,
          v(next.status), next.urgent ? 1 : 0, next.offered ? JSON.stringify(next.offered) : null,
          v(next.summary), v(next.note), v(next.endedAt), v(next.endedReason), v(next.recapSentAt),
          next.createdAt, now,
        )
        .run();
      return next;
    },

    async saveAppointment(a) {
      const c = a.caller ?? {};
      await db
        .prepare(
          `INSERT INTO appointments (call_id, at, label, nom, besoin, telephone, email, urgence, booking_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          a.callId, a.at, v(a.label), v(c.nom), v(c.besoin), v(c.telephone), v(c.email), v(c.urgence),
          v(a.bookingRef), a.createdAt ?? new Date().toISOString(),
        )
        .run();
      return a;
    },

    async findAppointmentByCallId(callId) {
      const row = await db.prepare('SELECT * FROM appointments WHERE call_id = ? ORDER BY id LIMIT 1').bind(callId).first();
      return row ? appointmentFromRow(row) : null;
    },

    async all() {
      const calls = (await db.prepare('SELECT * FROM calls ORDER BY created_at DESC').all())?.results ?? [];
      const appointments = (await db.prepare('SELECT * FROM appointments ORDER BY at').all())?.results ?? [];
      return { calls: calls.map(callFromRow), appointments: appointments.map(appointmentFromRow) };
    },
  };
}

function callFromRow(r) {
  const hasCaller = [r.nom, r.besoin, r.telephone, r.email].some((x) => x !== null && x !== undefined);
  return {
    callId: r.call_id,
    caller: hasCaller
      ? { nom: r.nom ?? '', besoin: r.besoin ?? '', urgence: r.urgence ?? 'normale', telephone: r.telephone, email: r.email, complet: !!r.complet }
      : null,
    offered: r.offered ? JSON.parse(r.offered) : null,
    status: r.status,
    urgent: !!r.urgent,
    summary: r.summary,
    note: r.note,
    endedAt: r.ended_at,
    endedReason: r.ended_reason,
    recapSentAt: r.recap_sent_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function appointmentFromRow(r) {
  return {
    callId: r.call_id,
    at: r.at,
    label: r.label,
    caller: { nom: r.nom, besoin: r.besoin, telephone: r.telephone, email: r.email, urgence: r.urgence },
    bookingRef: r.booking_ref,
    createdAt: r.created_at,
  };
}
