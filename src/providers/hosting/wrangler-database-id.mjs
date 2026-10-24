// The id `npm run db:id` writes into wrangler.toml: that of the D1 database named there, found in
// `wrangler d1 list --json`. Pure; scripts/set-database-id.mjs runs wrangler and writes the file.
// Only the value of `database_id` changes, so comments, settings and line endings stay as they are.
// A database outside the EU jurisdiction is still written, with a warning: the jurisdiction can only
// be set when the database is created (docs/DATA.md).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_LINE = /^database_name\s*=\s*"([^"]*)"/m;
const ID_LINE = /^(database_id\s*=\s*")([^"]*)(")/m;

/**
 * @param {{toml: string, databases: {uuid: string, name: string, jurisdiction?: string | null}[]}} input
 * @returns {{toml: string, message: string, warning?: string} | {error: string}}
 */
export function planDatabaseId({ toml, databases }) {
  const name = toml.match(NAME_LINE)?.[1];
  const current = toml.match(ID_LINE)?.[2];
  if (!name || current === undefined) {
    return { error: 'wrangler.toml needs a database_name and a database_id line under [[d1_databases]].' };
  }
  const db = databases.find((d) => d.name === name);
  if (!db) {
    return { error: `No D1 database named ${name} on this account. Create it first: npx wrangler d1 create ${name} --jurisdiction eu` };
  }
  if (!UUID.test(String(db.uuid))) return { error: `wrangler gave an unexpected id for ${name}: ${db.uuid}` };
  const warning = db.jurisdiction === 'eu'
    ? undefined
    : `${name} is not in the EU jurisdiction, so its records are not guaranteed to stay in the EU. Before it holds any record, recreate it: npx wrangler d1 delete ${name}, then npx wrangler d1 create ${name} --jurisdiction eu, then npm run db:id again.`;
  if (current === db.uuid) return { toml, message: `wrangler.toml already has the id of ${name} (${db.uuid}).`, warning };
  return { toml: toml.replace(ID_LINE, `$1${db.uuid}$3`), message: `wrangler.toml: database_id = "${db.uuid}" (${name}).`, warning };
}
