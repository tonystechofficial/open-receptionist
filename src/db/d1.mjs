// Cloudflare D1 store adapter. Same interface as src/db/store.mjs (see the comment there), backed
// by the migrations in migrations/. D1 is a Workers binding, so the database handle is passed in.
// D1 rejects `undefined` as a bound value, so every optional value goes through `v()`.

const v = (x) => (x === undefined ? null : x);

export function d1Store(db) {
  async function getCall(callId) {
    const row = await db.prepare('SELECT * FROM calls WHERE call_id = ?').bind(callId).first();
    return row ? callFromRow(row) : null;
  }

  return {
    getCall,

    async recordAttempt(a) {
      await db
        .prepare('INSERT INTO call_attempts (number, at, decision, reason, via, provider_call_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(v(a.number), a.at, a.decision, v(a.reason), a.via, v(a.providerCallId))
        .run();
      return a;
    },

    /** One query for the four counts the screen needs; only allowed calls count. */
    async attemptCounts({ number, now }) {
      const t = new Date(now).getTime();
      const hour = new Date(t - 3_600_000).toISOString();
      const day = new Date(t - 86_400_000).toISOString();
      const row = await db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN number = ? AND at >= ? THEN 1 ELSE 0 END), 0) AS number_hour,
             COALESCE(SUM(CASE WHEN number = ? THEN 1 ELSE 0 END), 0) AS number_day,
             COALESCE(SUM(CASE WHEN number IS NULL AND at >= ? THEN 1 ELSE 0 END), 0) AS anonymous_hour,
             COALESCE(SUM(CASE WHEN at >= ? THEN 1 ELSE 0 END), 0) AS total_hour
           FROM call_attempts WHERE decision = 'allowed' AND at >= ?`,
        )
        .bind(v(number), hour, v(number), hour, hour, day)
        .first();
      return {
        numberHour: Number(row?.number_hour ?? 0),
        numberDay: Number(row?.number_day ?? 0),
        anonymousHour: Number(row?.anonymous_hour ?? 0),
        totalHour: Number(row?.total_hour ?? 0),
      };
    },

    async attemptsSince(iso) {
      const rows = (await db.prepare('SELECT * FROM call_attempts WHERE at >= ? ORDER BY at').bind(iso).all())?.results ?? [];
      return rows.map((r) => ({
        number: r.number, at: r.at, decision: r.decision, reason: r.reason, via: r.via, providerCallId: r.provider_call_id,
      }));
    },

    /** The retention purge: everything created before the cut, in every table. */
    async purgeOlderThan(iso) {
      const changes = async (sql) => Number((await db.prepare(sql).bind(iso).run())?.meta?.changes ?? 0);
      return {
        appointments: await changes('DELETE FROM appointments WHERE created_at < ?'),
        calls: await changes('DELETE FROM calls WHERE created_at < ?'),
        attempts: await changes('DELETE FROM call_attempts WHERE at < ?'),
      };
    },

    async upsertCall(callId, patch) {
      const now = new Date().toISOString();
      const previous = await getCall(callId);
      const next = { ...(previous ?? { callId, createdAt: now }), ...patch, callId, updatedAt: now };
      const c = next.caller ?? {};
      await db
        .prepare(
          `INSERT INTO calls (call_id, nom, besoin, urgence, telephone, email, ville, adresse, complet, status, urgent,
             offered, summary, note, ended_at, ended_reason, recap_sent_at, deliveries, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(call_id) DO UPDATE SET
             nom = excluded.nom, besoin = excluded.besoin, urgence = excluded.urgence,
             telephone = excluded.telephone, email = excluded.email, ville = excluded.ville,
             adresse = excluded.adresse, complet = excluded.complet,
             status = excluded.status, urgent = excluded.urgent, offered = excluded.offered,
             summary = excluded.summary, note = excluded.note, ended_at = excluded.ended_at,
             ended_reason = excluded.ended_reason, recap_sent_at = excluded.recap_sent_at,
             deliveries = excluded.deliveries, updated_at = excluded.updated_at`,
        )
        .bind(
          callId, v(c.nom), v(c.besoin), v(c.urgence), v(c.telephone), v(c.email), v(c.ville), v(c.adresse), c.complet ? 1 : 0,
          v(next.status), next.urgent ? 1 : 0, next.offered ? JSON.stringify(next.offered) : null,
          v(next.summary), v(next.note), v(next.endedAt), v(next.endedReason), v(next.recapSentAt),
          next.deliveries ? JSON.stringify(next.deliveries) : null, next.createdAt, now,
        )
        .run();
      return next;
    },

    async saveAppointment(a) {
      const c = a.caller ?? {};
      await db
        .prepare(
          `INSERT INTO appointments (call_id, at, label, nom, besoin, telephone, email, ville, adresse, urgence, booking_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          a.callId, a.at, v(a.label), v(c.nom), v(c.besoin), v(c.telephone), v(c.email), v(c.ville), v(c.adresse), v(c.urgence),
          v(a.bookingRef), a.createdAt ?? new Date().toISOString(),
        )
        .run();
      return a;
    },

    async findAppointmentByCallId(callId) {
      const row = await db.prepare('SELECT * FROM appointments WHERE call_id = ? ORDER BY id LIMIT 1').bind(callId).first();
      return row ? appointmentFromRow(row) : null;
    },

    async callsUpdatedSince(iso) {
      const rows = (await db.prepare('SELECT * FROM calls WHERE updated_at >= ? ORDER BY updated_at').bind(iso).all())?.results ?? [];
      return rows.map(callFromRow);
    },

    async all() {
      const calls = (await db.prepare('SELECT * FROM calls ORDER BY created_at DESC').all())?.results ?? [];
      const appointments = (await db.prepare('SELECT * FROM appointments ORDER BY at').all())?.results ?? [];
      return { calls: calls.map(callFromRow), appointments: appointments.map(appointmentFromRow) };
    },
  };
}

function callFromRow(r) {
  const hasCaller = [r.nom, r.besoin, r.telephone, r.email, r.ville, r.adresse].some((x) => x !== null && x !== undefined);
  return {
    callId: r.call_id,
    caller: hasCaller
      ? {
        nom: r.nom ?? '', besoin: r.besoin ?? '', urgence: r.urgence ?? 'normale', telephone: r.telephone, email: r.email,
        ville: r.ville ?? null, adresse: r.adresse ?? null, complet: !!r.complet,
      }
      : null,
    offered: r.offered ? JSON.parse(r.offered) : null,
    status: r.status,
    urgent: !!r.urgent,
    summary: r.summary,
    note: r.note,
    endedAt: r.ended_at,
    endedReason: r.ended_reason,
    recapSentAt: r.recap_sent_at,
    deliveries: r.deliveries ? JSON.parse(r.deliveries) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function appointmentFromRow(r) {
  return {
    callId: r.call_id,
    at: r.at,
    label: r.label,
    caller: { nom: r.nom, besoin: r.besoin, telephone: r.telephone, email: r.email, ville: r.ville ?? null, adresse: r.adresse ?? null, urgence: r.urgence },
    bookingRef: r.booking_ref,
    createdAt: r.created_at,
  };
}
