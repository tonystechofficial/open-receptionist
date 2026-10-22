// Cloudflare D1 store adapter: implements the same { saveCall, saveAppointment, all }
// interface as src/db/store.mjs, so the rest of the code does not change.
// D1 is a Workers binding, so the database handle is passed in (env.DB).

export function d1Store(db) {
  return {
    async saveCall(r) {
      const c = r.caller ?? {};
      const res = await db
        .prepare(
          `INSERT INTO calls (nom, besoin, urgence, telephone, email, complet, souhaite, summary, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          c.nom ?? null, c.besoin ?? null, c.urgence ?? null, c.telephone ?? null, c.email ?? null,
          c.complet ? 1 : 0, r.souhaite ?? null, r.summary ?? null, r.endedAt ?? null,
        )
        .run();
      return { id: String(res?.meta?.last_row_id ?? ''), ...r };
    },

    async saveAppointment(r) {
      const c = r.caller ?? {};
      await db
        .prepare(
          `INSERT INTO appointments (at, nom, besoin, telephone, email, booking_ref)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(r.at ?? null, c.nom ?? null, c.besoin ?? null, c.telephone ?? null, c.email ?? null, bookingRef(r.booking))
        .run();
      return r;
    },

    async all() {
      const calls = (await db.prepare('SELECT * FROM calls ORDER BY id DESC').all())?.results ?? [];
      const appointments = (await db.prepare('SELECT * FROM appointments ORDER BY id DESC').all())?.results ?? [];
      return { calls, appointments };
    },
  };
}

function bookingRef(b) {
  if (!b) return null;
  return String(b.uid ?? b.id ?? b.data?.uid ?? b.data?.id ?? '') || null;
}
