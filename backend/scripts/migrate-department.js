/**
 * One-time single-department migration CLI.
 *
 *   npm run department:migrate -- --yes
 *
 * Calls the Apps Script `migrate_single_department` action directly with the
 * API key (no session / admin token needed). It reassigns every department-
 * scoped row to CS01 and collapses the Departments sheet to a single canonical
 * row. Idempotent: running it when everything is already CS01 changes nothing.
 *
 * First check the deployment is healthy with: npm run bridge:check
 */
const env = require('../src/config/env');

const args = process.argv.slice(2);
const yes = args.includes('--yes') || args.includes('-y');

const run = async () => {
  const key = env.appsScriptApiKey;
  if (!key) {
    process.stdout.write(
      'APPS_SCRIPT_API_KEY is empty in backend/.env and the bridge fails closed.\n' +
        'Set it (and the matching API_KEY Script Property in Apps Script) first.\n'
    );
    process.exitCode = 1;
    return;
  }
  if (!yes) {
    process.stdout.write(
      'This reassigns every department-scoped row in Google Sheets to CS01 and\n' +
        'removes every other department row. Idempotent, but irreversible.\n' +
        'Re-run with --yes to confirm.\n'
    );
    process.exitCode = 1;
    return;
  }

  const response = await fetch(env.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'migrate_single_department', key }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!payload) {
    process.stdout.write(`The bridge did not answer JSON: ${text.slice(0, 160)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = payload.success ? 0 : 1;
};

run().catch((error) => {
  process.stderr.write(`Migration failed: ${(error && error.message) || error}\n`);
  process.exitCode = 1;
});