// Asks for the business's settings one at a time, says what each one is for, checks every answer with
// the Worker's own rules, and writes them into the [vars] of wrangler.toml (README, docs/SETUP.md
// step 3.3). Run it again whenever a setting changes, then `npm run deploy`.
//
//   npm run configure
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { validateClientConfig, configFromVars } from '../src/core/config.mjs';
import { QUESTIONS, readVars, writeVars, normalizeAnswer, checkAnswer } from '../src/providers/hosting/wrangler-vars.mjs';

const file = new URL('../wrangler.toml', import.meta.url);
if (!existsSync(file)) {
  console.error('No wrangler.toml yet: run `npm run db:id` first, it creates it.');
  process.exit(1);
}
const toml = readFileSync(file, 'utf8');
const template = readVars(readFileSync(new URL('../wrangler.example.toml', import.meta.url), 'utf8'));
const examples = { ...template.commented, ...template.active };
const current = readVars(toml).active;

// Lines are read through an iterator, which buffers them: typed answers and piped ones both work.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const lines = rl[Symbol.asyncIterator]();
const stop = () => {
  console.log('\nStopped: wrangler.toml unchanged.');
  process.exit(130);
};
rl.on('SIGINT', stop);
async function ask(prompt) {
  rl.setPrompt(prompt);
  rl.prompt();
  const { value, done } = await lines.next();
  if (done) stop();
  return value.trim();
}

console.log(`The business's settings, ${QUESTIONS.length} questions. Each answer is checked with the rules the Worker
applies; nothing is written before the last one. Enter keeps the value in [brackets], - leaves an optional
one empty, Ctrl+C stops without writing.
`);

const answers = { ...current };
for (const [i, q] of QUESTIONS.entries()) {
  const now = current[q.key];
  const kept = now !== undefined && !(q.contact && now === examples[q.key]) ? now : '';
  const shown = q.yesNo && kept ? (kept === 'false' ? 'no' : 'yes') : kept;
  console.log(`${i + 1}/${QUESTIONS.length}  ${q.title}${q.required || q.yesNo ? '' : ' (optional)'}`);
  console.log(`      ${q.help}`);
  console.log(`      Example: ${q.example}`);
  for (;;) {
    const raw = await ask(`      ${q.key}${shown ? ` [${shown}]` : ''}: `);
    const value = raw === '' ? kept : raw === '-' ? '' : normalizeAnswer(q, raw);
    const error = checkAnswer(q.key, value, { ...answers, [q.key]: value }, { examples });
    if (!error) {
      answers[q.key] = value;
      break;
    }
    console.log(`      ✗ ${error}`);
  }
  console.log('');
}

console.log('To write into wrangler.toml:');
for (const q of QUESTIONS) console.log(`  ${q.key} = "${answers[q.key] ?? ''}"`);
if (normalizeAnswer({ yesNo: true }, (await ask('\nWrite them? [yes]: ')) || 'yes') !== 'true') {
  console.log('Nothing written.');
  process.exit(0);
}
writeFileSync(file, writeVars(toml, Object.fromEntries(QUESTIONS.map((q) => [q.key, answers[q.key] ?? '']))));

const { errors, warnings } = validateClientConfig(configFromVars(answers), { providers: { email: true, sms: true } });
for (const e of errors) console.log(`  ✗ ${e}`);
for (const w of warnings) console.log(`  ! ${w}`);
console.log('\nSaved in wrangler.toml. Next: npm run deploy. Whenever a setting changes: npm run configure, then npm run deploy.');
rl.close();
