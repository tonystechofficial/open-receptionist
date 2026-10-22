// The database is the SOURCE OF TRUTH. The voice platform is only transport.
// Two tiny reference stores ship here; in production swap for Postgres, SQLite or Upstash.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** In-memory store. Fine for local runs and tests; loses data between serverless invocations. */
export function memoryStore() {
  const calls = [];
  const appointments = [];
  return {
    async saveCall(r) { const rec = { id: String(calls.length + 1), ...r }; calls.push(rec); return rec; },
    async saveAppointment(r) { appointments.push(r); return r; },
    async all() { return { calls, appointments }; },
  };
}

/** JSON-file store. Good enough for a single-machine demo. Not concurrency-safe. */
export function jsonFileStore(path) {
  async function load() {
    try { return JSON.parse(await readFile(path, 'utf8')); } catch { return { calls: [], appointments: [] }; }
  }
  async function save(db) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(db, null, 2)); }
  return {
    async saveCall(r) { const db = await load(); const rec = { id: String(db.calls.length + 1), ...r }; db.calls.push(rec); await save(db); return rec; },
    async saveAppointment(r) { const db = await load(); db.appointments.push(r); await save(db); return r; },
    async all() { return load(); },
  };
}
