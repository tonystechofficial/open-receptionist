// The database is the SOURCE OF TRUTH. The voice platform is only transport.
//
// Store interface, implemented here (memory, JSON file) and in d1.mjs (Cloudflare D1):
//   getCall(callId)                  -> call record or null
//   upsertCall(callId, patch)        -> merged call record (created on first write)
//   saveAppointment(appointment)     -> appointment ({ callId, at, label, caller, bookingRef, createdAt })
//   findAppointmentByCallId(callId)  -> appointment or null
//   callsUpdatedSince(iso)           -> calls updated at or after that instant (the daily check)
//   recordAttempt(attempt)           -> attempt ({ number, at, decision, reason, via, providerCallId })
//   attemptCounts({ number, now })   -> { numberHour, numberDay, anonymousHour, totalHour }, allowed only
//   attemptsSince(iso)               -> attempts at or after that instant, oldest first
//   all()                            -> { calls, appointments }
// A call record holds { callId, caller, offered, status, urgent, summary, note, endedAt,
// endedReason, recapSentAt, deliveries, createdAt, updatedAt }, `deliveries` being what was sent to
// whom and what failed. Stores stay dumb: merging the caller's details is the handlers' job
// (mergeCaller), the store just keeps what it is given.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

function merge(previous, callId, patch) {
  const at = new Date().toISOString();
  return { ...(previous ?? { callId, createdAt: at }), ...patch, callId, updatedAt: at };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function attemptRow(a) {
  return { number: a.number ?? null, at: a.at, decision: a.decision, reason: a.reason ?? null, via: a.via, providerCallId: a.providerCallId ?? null };
}

/** The counts the screen needs, from a list of attempts: allowed calls only. */
function countAttempts(attempts, number, now) {
  const t = new Date(now).getTime();
  const hour = new Date(t - HOUR_MS).toISOString();
  const day = new Date(t - DAY_MS).toISOString();
  const allowed = attempts.filter((a) => a.decision === 'allowed');
  return {
    numberHour: number ? allowed.filter((a) => a.number === number && a.at >= hour).length : 0,
    numberDay: number ? allowed.filter((a) => a.number === number && a.at >= day).length : 0,
    anonymousHour: allowed.filter((a) => a.number === null && a.at >= hour).length,
    totalHour: allowed.filter((a) => a.at >= hour).length,
  };
}

const since = (attempts, iso) => attempts.filter((a) => a.at >= iso).sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

/** In-memory store. Fine for local runs and tests; loses data between serverless invocations. */
export function memoryStore() {
  const calls = new Map();
  const appointments = [];
  const attempts = [];
  return {
    async recordAttempt(a) { const row = attemptRow(a); attempts.push(row); return row; },
    async attemptCounts({ number, now }) { return countAttempts(attempts, number, now); },
    async attemptsSince(iso) { return since(attempts, iso); },
    async getCall(callId) { return calls.get(callId) ?? null; },
    async upsertCall(callId, patch) {
      const next = merge(calls.get(callId), callId, patch);
      calls.set(callId, next);
      return next;
    },
    async saveAppointment(a) { appointments.push(a); return a; },
    async findAppointmentByCallId(callId) { return appointments.find((a) => a.callId === callId) ?? null; },
    async callsUpdatedSince(iso) { return [...calls.values()].filter((c) => c.updatedAt >= iso); },
    async all() { return { calls: [...calls.values()], appointments: appointments.slice() }; },
  };
}

/** JSON-file store. Good enough for a single-machine demo. Not concurrency-safe. */
export function jsonFileStore(path) {
  async function load() {
    try {
      const db = JSON.parse(await readFile(path, 'utf8'));
      return { calls: db.calls ?? {}, appointments: db.appointments ?? [], attempts: db.attempts ?? [] };
    } catch {
      return { calls: {}, appointments: [], attempts: [] };
    }
  }
  async function save(db) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(db, null, 2));
  }
  return {
    async recordAttempt(a) { const db = await load(); const row = attemptRow(a); db.attempts.push(row); await save(db); return row; },
    async attemptCounts({ number, now }) { return countAttempts((await load()).attempts, number, now); },
    async attemptsSince(iso) { return since((await load()).attempts, iso); },
    async getCall(callId) { return (await load()).calls[callId] ?? null; },
    async upsertCall(callId, patch) {
      const db = await load();
      db.calls[callId] = merge(db.calls[callId], callId, patch);
      await save(db);
      return db.calls[callId];
    },
    async saveAppointment(a) { const db = await load(); db.appointments.push(a); await save(db); return a; },
    async findAppointmentByCallId(callId) { return (await load()).appointments.find((a) => a.callId === callId) ?? null; },
    async callsUpdatedSince(iso) { return Object.values((await load()).calls).filter((c) => c.updatedAt >= iso); },
    async all() { const db = await load(); return { calls: Object.values(db.calls), appointments: db.appointments }; },
  };
}
