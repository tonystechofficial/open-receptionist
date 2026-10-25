// README.local.md, written by `npm run readme:local`: the steps after the deploy, with the Worker's
// own address in every command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { workerUrl, localReadme } from '../src/setup/local-readme.mjs';

test('the address the deploy printed is kept as its origin, whatever is around it', () => {
  assert.equal(workerUrl('https://open-receptionist.tonystech.workers.dev'), 'https://open-receptionist.tonystech.workers.dev');
  assert.equal(workerUrl('  https://open-receptionist.tonystech.workers.dev/health/ '), 'https://open-receptionist.tonystech.workers.dev');
  assert.equal(workerUrl('open-receptionist.tonystech.workers.dev'), 'https://open-receptionist.tonystech.workers.dev');
});

test('anything that is not an address is refused', () => {
  assert.equal(workerUrl(''), null);
  assert.equal(workerUrl('not an address'), null);
  assert.equal(workerUrl('http://open-receptionist.tonystech.workers.dev'), null); // the Worker is https only
});

test('every command carries the address, and no placeholder of it is left', () => {
  const page = localReadme({ url: 'https://open-receptionist.tonystech.workers.dev', eventTypeId: '7633528' });
  assert.match(page, /curl https:\/\/open-receptionist\.tonystech\.workers\.dev\/health/);
  assert.match(page, /WEBHOOK_BASE_URL=https:\/\/open-receptionist\.tonystech\.workers\.dev /);
  assert.match(page, /https:\/\/open-receptionist\.tonystech\.workers\.dev\/api\/twilio\/voice/);
  assert.match(page, /7633528/);
  assert.doesNotMatch(page, /<your-subdomain>|<you>/);
});

test('secrets stay placeholders: the page never holds one', () => {
  const page = localReadme({ url: 'https://w.example.workers.dev' });
  assert.match(page, /<WEBHOOK_SECRET>/);
  assert.match(page, /VAPI_PRIVATE_KEY=<private key>/);
});
