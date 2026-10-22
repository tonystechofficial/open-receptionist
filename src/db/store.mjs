// The database is the SOURCE OF TRUTH. The voice platform is only transport.
//
// Store interface, implemented here (memory, JSON file) and in d1.mjs (Cloudflare D1):
//   getCall(callId)                  -> call record or null
//   upsertCall(callId, patch)        -> merged call record (created on first write)
//   saveAppointment(appointment)     -> appointment ({ callId, at, label, caller, bookingRef, createdAt })
//   findAppointmentByCallId(callId)  -> appointment or null
//   all()                            -> { calls, appointments }
// A call record holds { callId, caller, offered, status, urgent, summary, note, endedAt,
// endedReason, recapSentAt, createdAt, updatedAt }. Stores stay dumb: merging the caller's
// details is the handlers' job (mergeCaller), the store just keeps what it is given.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

function merge(previous, callId, patch) {
  const at = new Date().toISOString();
  return { ...(previous ?? { callId, createdAt: at }), ...patch, callId, updatedAt: at };
}

/** In-memory store. Fine for local runs and tests; loses data between serverless invocations. */
export function memoryStore() {
  const calls = new Map();
  const appointments = [];
  return {
    async getCall(callId) { return calls.get(callId) ?? null; },
    async upsertCall(callId, patch) {
      const next = merge(calls.get(callId), callId, patch);
      calls.set(callId, next);
      return next;
    },
    async saveAppointment(a) { appointments.push(a); return a; },
    async findAppointmentByCallId(callId) { return appointments.find((a) => a.callId === callId) ?? null; },
    async all() { return { calls: [...calls.values()], appointments: appointments.slice() }; },
  };
}

/** JSON-file store. Good enough for a single-machine demo. Not concurrency-safe. */
export function jsonFileStore(path) {
  async function load() {
    try {
      const db = JSON.parse(await readFile(path, 'utf8'));
      return { calls: db.calls ?? {}, appointments: db.appointments ?? [] };
    } catch {
      return { calls: {}, appointments: [] };
    }
  }
  async function save(db) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(db, null, 2));
  }
  return {
    async getCall(callId) { return (await load()).calls[callId] ?? null; },
    async upsertCall(callId, patch) {
      const db = await load();
      db.calls[callId] = merge(db.calls[callId], callId, patch);
      await save(db);
      return db.calls[callId];
    },
    async saveAppointment(a) { const db = await load(); db.appointments.push(a); await save(db); return a; },
    async findAppointmentByCallId(callId) { return (await load()).appointments.find((a) => a.callId === callId) ?? null; },
    async all() { const db = await load(); return { calls: Object.values(db.calls), appointments: db.appointments }; },
  };
}
