/**
 * Diagnoses the Google Apps Script bridge before you fight the UI with it.
 *
 *   npm run bridge:check
 *
 * Tells you which of the usual deployment mistakes is in the way:
 *   - the deployment is not public ("You need access" interstitial)
 *   - the bridge rejects the call because API_KEY is missing/mismatched
 *   - SPREADSHEET_ID is not configured
 *   - the sheets have not been created yet (setupSheets never ran)
 *   - the deployed script is an older build than this backend expects
 */
const env = require('../src/config/env');
const googleAuth = require('../src/services/googleAuth');

const check = async () => {
  const url = env.appsScriptUrl;
  const key = env.appsScriptApiKey;
  const lines = [];
  const say = (line = '') => lines.push(line);
  let emitted = false;
  const emit = () => {
    if (emitted) return;
    emitted = true;
    process.stdout.write(`${lines.join('\n')}\n`);
  };

  say('Google Apps Script bridge check');
  say('='.repeat(60));
  say(`URL      : ${url}`);
say(`API key  : ${key ? `${key.slice(0, 6)}...${key.slice(-4)} (${key.length} chars)` : 'NOT SET in backend/.env'}`);
  say(`Google auth: ${googleAuth.isConfigured() ? `service account ${googleAuth.email()}` : 'anonymous (no service account)'}`);
  say('');

  if (!key) {
    say('! APPS_SCRIPT_API_KEY is empty.');
    say('  The bridge fails closed, so every call will be rejected.');
    say('  Set the same value as the API_KEY Script Property in Apps Script.');
    say('');
  }

  // --- 1. is the deployment reachable and public at all?
  let payload = null;
  try {
    const res = await fetch(`${url}?action=setup_sheets${key ? `&key=${encodeURIComponent(key)}` : ''}`, {
      redirect: 'follow',
      headers: { Accept: 'application/json' },
    });
    const text = await res.text();

    if (!res.ok) {
      say(`X HTTP ${res.status} from Google.`);
      if (res.status === 401 || res.status === 403) {
        say('');
        say('  This is Google refusing the CALLER, not our script. The web app');
        say('  deployment is not public. Fix it in Apps Script:');
        say('    Deploy > Manage deployments > Edit (pencil icon) >');
        say('    Who has access: Anyone > Save > Redeploy (new version).');
      } else {
        say(`  ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
      }
      say('');
      emit();
      return 1;
    }

try {
      payload = JSON.parse(text);
    } catch {
      const lower = text.toLowerCase();
      say('X The deployment returned an HTML page instead of JSON.');
      if (lower.includes('accounts.google.com') || lower.includes('sign in')) {
        say('');
        say('  This is the Google SIGN-IN page: the deployment requires a Google');
        say('  account. The backend cannot sign in, so the bridge must be public.');
        say('');
        say('  Fix in Apps Script: Deploy > Manage deployments > Edit (pencil icon) >');
        say('  "Who has access: Anyone" > Save, then create a NEW deployment version.');
        say('  ("Anyone with Google account" is not enough.)');
      } else if (lower.includes('you need access') || lower.includes('access denied')) {
        say('');
        say('  This is the Google "Access denied" page: the deployment is not public.');
        say('');
        say('  Fix in Apps Script: Deploy > Manage deployments > Edit (pencil icon) >');
        say('  "Who has access: Anyone" > Save, then create a NEW deployment version.');
      } else if (lower.includes('script error') || lower.includes('exception:')) {
        say('');
        say('  The deployed script threw an error. Open the Executions page in the');
        say('  Apps Script editor to read the trace, then redeploy Code.gs.');
      } else {
        say('');
        say('  Unrecognised HTML response. Confirm APPS_SCRIPT_URL points at a');
        say('  /exec deployment URL and not the editor or a /dev URL.');
      }
      say('');
      say(`  First 120 chars: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      say('');
      emit();
      return 1;
    }
  } catch (error) {
    say(`X Could not reach the deployment: ${error.message}`);
    say('');
    emit();
    return 1;
  }

  // --- 2. did our own guard reject the call?
  if (payload.success === false && /unauthorized/i.test(payload.message || '')) {
    say('X The bridge rejected our key.');
    say(`  Deployed message: ${payload.message}`);
    say('  The API_KEY Script Property does not match APPS_SCRIPT_API_KEY.');
    say('');
    emit();
    return 1;
  }

  // --- 3. sheets present?
  if (payload.success === true) {
    const sheets = Array.isArray(payload.data) ? payload.data : [];
    say(`V Bridge reachable and authorised.`);
    say(`V Sheets ready (${sheets.length}): ${sheets.join(', ')}`);
  } else {
    say(`X Bridge reachable, but setup failed: ${payload.message || 'unknown error'}`);
    if (payload.error) say(`  Error: ${payload.error}`);
    if (/entity is required/i.test(payload.message || '')) {
      say('');
      say('  "Entity is required" means SPREADSHEET_ID is empty. Set either');
      say('  SETTINGS.SPREADSHEET_ID in Code.gs or a SPREADSHEET_ID Script Property.');
    } else if (/does not exist/i.test(payload.message || '')) {
      say('  Run setupSheets() once from the Apps Script editor.');
    } else {
      say('');
      say('  This response does not match this backend\'s Code.gs contract.');
      say('  The deployment is probably an older build - redeploy the current');
      say('  apps-script/Code.gs, then run setupSheets() again.');
    }
  }

  say('');
  emit();
  return payload.success === true ? 0 : 1;
};

check()
  .then((code) => {
    // Set exitCode instead of calling process.exit: forcing an exit while
    // undici's fetch socket is still closing trips a libuv assertion on
    // Windows.
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`Bridge check crashed: ${error.message}\n`);
    process.exitCode = 1;
  });