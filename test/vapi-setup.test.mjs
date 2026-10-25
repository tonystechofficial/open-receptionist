// npm run vapi:setup: the local secrets file it reads and updates, and the Vapi credential it creates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnv, writeEnv, credentialBody } from '../src/setup/vapi-setup.mjs';

const FILE = '# Local secrets, ignored by git.\r\n# Vapi dashboard > API Keys\r\nVAPI_PRIVATE_KEY=abc-123\r\n';

test('the file is read as KEY=value, comments and blank lines ignored', () => {
  assert.deepEqual(readEnv(FILE), { VAPI_PRIVATE_KEY: 'abc-123' });
  assert.deepEqual(readEnv('A = 1\nB="two"\n\n# C=3\n'), { A: '1', B: 'two' });
  assert.deepEqual(readEnv(''), {});
});

test('a value is updated in place or added at the end; comments and line endings stay', () => {
  const out = writeEnv(FILE, { VAPI_PRIVATE_KEY: 'abc-123', VAPI_CREDENTIAL_ID: 'cred_1' });
  assert.equal(out, `${FILE}VAPI_CREDENTIAL_ID=cred_1\r\n`);
  assert.equal(writeEnv(out, { VAPI_CREDENTIAL_ID: 'cred_2' }), `${FILE}VAPI_CREDENTIAL_ID=cred_2\r\n`);
});

test("the credential sends the webhook secret as X-Vapi-Secret, without the 'Bearer ' prefix", () => {
  assert.deepEqual(credentialBody('s3cret'), {
    provider: 'custom-credential',
    name: 'open-receptionist webhook',
    authenticationPlan: { type: 'bearer', token: 's3cret', headerName: 'X-Vapi-Secret', bearerPrefixEnabled: false },
  });
});
