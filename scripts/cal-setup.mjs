// Creates the Cal.com event type the receptionist books into (docs/SETUP.md step 1.2), or finds it
// if it already exists, then writes its id into wrangler.toml and config/client.json. The API key is
// asked for, masked, unless CALCOM_API_KEY is set; it is used for this run only, never stored or
// printed. (The copy set with `wrangler secret put` cannot be read back: only the Worker sees it.)
//
//   npm run cal:setup
//   Options: npm run cal:setup -- --title="Intervention" --minutes=60 --buffer=30 --notice=60
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { eventTypeBody, findEventType } from '../src/providers/calendar/calcom-setup.mjs';
import { writeVars } from '../src/providers/hosting/wrangler-vars.mjs';

/** Reads one line; in a terminal, each typed character shows as *. */
function askSecret(prompt) {
  process.stdout.write(prompt);
  const { stdin } = process;
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin });
    return new Promise((resolve) => rl.once('line', (line) => { rl.close(); resolve(line.trim()); }));
  }
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') {
          if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
        } else {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

const key = process.env.CALCOM_API_KEY || await askSecret('Cal.com API key (Settings > Developer > API keys), the same one as in wrangler secret: ');
if (!key) {
  console.error('No key given: nothing done.');
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
