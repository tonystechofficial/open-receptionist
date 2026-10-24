// The database id that `npm run db:id` writes into wrangler.toml, from `wrangler d1 list --json`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planDatabaseId } from '../src/providers/hosting/wrangler-database-id.mjs';

const TOML = [
  'name = "open-receptionist"',
  '# Create the database once in the EU jurisdiction, then: npm run db:id',
  '[[d1_databases]]',
  'binding = "DB"',
  'database_name = "open-receptionist"',
  'database_id = "REPLACE_WITH_D1_DATABASE_ID"',
  'migrations_dir = "migrations"',
  '',
  '[vars]',
  'CLIENT_COMPANY = "Plomberie Dupont"',
  '',
].join('\n');
const ID = '0f8c2b1e-5d4a-4c3b-9a2f-6e7d8c9b0a1f';
const EU = { uuid: ID, name: 'open-receptionist', jurisdiction: 'eu' };
const withId = (id) => TOML.replace('REPLACE_WITH_D1_DATABASE_ID', id);

test('the id of the database named in wrangler.toml replaces the placeholder, and nothing else changes', () => {
  const other = { uuid: '11111111-2222-3333-4444-555555555555', name: 'other', jurisdiction: 'eu' };
  const plan = planDatabaseId({ toml: TOML, databases: [other, EU] });
  assert.equal(plan.toml, withId(ID));
  assert.match(plan.message, new RegExp(ID));
  assert.equal(plan.warning, undefined);
});

test('Windows line endings survive', () => {
  const crlf = TOML.replace(/\n/g, '\r\n');
  assert.equal(planDatabaseId({ toml: crlf, databases: [EU] }).toml, crlf.replace('REPLACE_WITH_D1_DATABASE_ID', ID));
});

test('a database recreated under the same name replaces the old id', () => {
  const plan = planDatabaseId({ toml: withId('00000000-0000-0000-0000-000000000000'), databases: [EU] });
  assert.equal(plan.toml, withId(ID));
});

test('when wrangler.toml already has the id, nothing changes', () => {
  const plan = planDatabaseId({ toml: withId(ID), databases: [EU] });
  assert.equal(plan.toml, withId(ID));
  assert.match(plan.message, /already/);
});

test('a database outside the EU jurisdiction is written, with a warning saying which one and how to recreate it', () => {
  const plan = planDatabaseId({ toml: TOML, databases: [{ ...EU, jurisdiction: null, created_at: '2026-10-24T19:55:12.526Z' }] });
  assert.equal(plan.toml, withId(ID));
  assert.match(plan.warning, /created 2026-10-24 19:55 UTC/);
  assert.match(plan.warning, /A database with that name already exists/); // why a new `d1 create` fails while it exists
  assert.match(plan.warning, /npx wrangler d1 delete open-receptionist, then npx wrangler d1 create open-receptionist --jurisdiction eu/);
});

test('with no database of that name, it says how to create one and writes nothing', () => {
  const plan = planDatabaseId({ toml: TOML, databases: [{ ...EU, name: 'other' }] });
  assert.match(plan.error, /npx wrangler d1 create open-receptionist --jurisdiction eu/);
  assert.equal(plan.toml, undefined);
});

test('a wrangler.toml without its database_name or database_id line is refused', () => {
  assert.ok(planDatabaseId({ toml: TOML.replace(/^database_name.*$/m, ''), databases: [EU] }).error);
  assert.ok(planDatabaseId({ toml: TOML.replace(/^database_id.*$/m, ''), databases: [EU] }).error);
});

test('an id that is not a UUID is never written', () => {
  const plan = planDatabaseId({ toml: TOML, databases: [{ ...EU, uuid: 'x" injected = "y' }] });
  assert.ok(plan.error);
  assert.equal(plan.toml, undefined);
});
