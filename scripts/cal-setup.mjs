// Creates the Cal.com event type the receptionist books into (docs/SETUP.md step 1.2), or finds it
// if it already exists, then writes its id into wrangler.toml and config/client.json. The API key is
// read from the environment, never from a file or an argument, and never printed.
//
//   PowerShell:  $env:CALCOM_API_KEY = "cal_live_..."; npm run cal:setup
//   Bash:        CALCOM_API_KEY=cal_live_... npm run cal:setup
//   Options:     npm run cal:setup -- --title="Intervention" --minutes=60 --buffer=30 --notice=60
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { eventTypeBody, findEventType } from '../src/providers/calendar/calcom-setup.mjs';
import { writeVars } from '../src/providers/hosting/wrangler-vars.mjs';

const key = process.env.CALCOM_API_KEY;
if (!key) {
  console.error('CALCOM_API_KEY is not set. In PowerShell: $env:CALCOM_API_KEY = "cal_live_..."; npm run cal:setup');
  process.exit(1);
}
const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const number = (name) => (flag(name) === undefined ? undefined : Number(flag(name)));
const body = eventTypeBody({ title: flag('title'), minutes: number('minutes'), buffer: number('buffer'), notice: number('notice') });
for (const [k, v] of Object.entries(body)) if (v === undefined) delete body[k];

const BASE = 'https://api.cal.com/v2';
async function cal(method, path, payload, version) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(version ? { 'cal-api-version': version } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Cal.com refused ${method} ${path} (${res.status}): ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
    process.exit(1);
  }
  return data.data;
}

const me = await cal('GET', '/me');
const list = await cal('GET', `/event-types?username=${encodeURIComponent(me.username)}`, null, '2026-06-12');
let eventType = findEventType(list, body.slug);
if (eventType) {
  console.log(`Event type "${eventType.title}" already exists (id ${eventType.id}): kept as it is.`);
} else {
  eventType = await cal('POST', '/event-types', body, '2026-06-12');
  console.log(`Created "${eventType.title}" (id ${eventType.id}): ${body.lengthInMinutes} min, ${body.afterEventBuffer} min after, bookable ${body.minimumBookingNotice} min ahead, phone required, email optional.`);
}

const id = String(eventType.id);
const toml = new URL('../wrangler.toml', import.meta.url);
if (existsSync(toml)) {
  writeFileSync(toml, writeVars(readFileSync(toml, 'utf8'), { CALCOM_EVENT_TYPE_ID: id }));
  console.log(`wrangler.toml: CALCOM_EVENT_TYPE_ID = "${id}"`);
}
const client = new URL('../config/client.json', import.meta.url);
if (existsSync(client)) {
  const config = JSON.parse(readFileSync(client, 'utf8'));
  config.calendar = { ...(config.calendar ?? {}), provider: 'calcom', id };
  writeFileSync(client, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`config/client.json: calendar.id = "${id}"`);
}
console.log(`
Still to do in Cal.com, once: connect the calendar the bookings should land in (Settings > Calendars),
and set your working hours (Availability). Then npm run deploy, so the Worker uses the new id.`);
