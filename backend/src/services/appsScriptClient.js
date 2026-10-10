/**
 * Google Apps Script bridge client.
 * All Google Sheets access goes through here — the frontend never talks to Apps Script directly.
 */
const env = require('../config/env');
const googleAuth = require('./googleAuth');
const cacheEpoch = require('./cacheEpoch');

const TIMEOUT_MS = Number(process.env.APPS_SCRIPT_TIMEOUT_MS || 25000);

class AppsScriptError extends Error {
  constructor(message, details, reason) {
    super(message);
    this.name = 'AppsScriptError';
    this.status = 502;
    this.details = details || null;
    // Machine-readable cause so the API and UI can explain what to fix.
    this.reason = reason || 'unknown';
  }
}

/**
 * Google answers a call it does not like with an HTML page, not JSON:
 *  - 401/403 + "You need access"  -> the deployment is not public
 *  - 200 + "Script error"         -> the deployed script threw
 *  - anything else HTML           -> sign-in wall or a bad /exec URL
 * Detecting these turns an opaque "malformed JSON" failure into an actionable one.
 */
const diagnoseHtml = (text) => {
  const body = String(text || '');
  const lower = body.toLowerCase();

  if (lower.includes('you need access') || lower.includes('access denied') || lower.includes('request-access')) {
    return {
      reason: 'deployment_not_public',
      message:
        'Google Apps Script refused the request because the web app deployment is not public. ' +
        'In Apps Script choose Deploy > Manage deployments > Edit (pencil icon) > ' +
        '"Who has access: Anyone" > Save, then create a new deployment version.',
    };
  }
  if (lower.includes('sign in') || lower.includes('accounts.google.com')) {
    return {
      reason: 'sign_in_required',
      message:
        'Google Apps Script asked us to sign in, so the deployment is restricted to Google accounts. ' +
        'Either set "Who has access: Anyone" in Apps Script, or set GOOGLE_SERVICE_ACCOUNT_EMAIL and ' +
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in backend/.env and share the Apps Script project and ' +
        'spreadsheet with that service account (see DEPLOYMENT.md).',
    };
  }
  if (lower.includes('script error') || lower.includes('exception:')) {
    return {
      reason: 'script_threw',
      message:
        'The deployed Google Apps Script threw an error. Open the Executions page in the ' +
        'Apps Script editor to read the stack trace, then redeploy apps-script/Code.gs.',
    };
  }
  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
    return {
      reason: 'html_response',
      message:
        'Google Apps Script returned a web page instead of JSON. Check that APPS_SCRIPT_URL ' +
        'points at a /exec deployment and that it is shared with "Anyone".',
    };
  }
  return {
    reason: 'malformed_response',
    message: `Google Apps Script returned a malformed JSON response (received ${body.slice(0, 80).replace(/\s+/g, ' ')}...)`,
  };
};

const normalizeResponse = (payload) => {
  if (payload && typeof payload === 'object') {
    if (payload.success === true) return payload;
    const raw = payload.message || payload.error || '';

    // The legacy deployment reports an empty table as a failure. It is not one.
    if (protocol === 'legacy' && /no records found/i.test(String(raw))) {
      return { success: true, data: [] };
    }
    if (protocol === 'legacy' && /invalid table/i.test(String(raw))) {
      const table = String(raw).split(':').pop().trim();
      throw new AppsScriptError(
        `The connected Apps Script deployment has no "${table}" sheet. It only provides ` +
          'Users, Students, Faculty, Departments, Subjects, Attendance, Materials, Assignments, ' +
          `Marks, Timetable and Announcements. Deploy apps-script/Code.gs to add ${table}.`,
        payload,
        'table_not_supported'
      );
    }

    // The deployment answered, but it does not implement this backend's
    // contract. Say so plainly instead of leaking "Invalid GET action".
    if (/invalid (get|post) action|erp api is running/i.test(String(raw))) {
      throw new AppsScriptError(
        'The connected Google Apps Script deployment does not match this backend. ' +
          `It answered "${String(raw).slice(0, 60)}" instead of serving the ERP bridge. ` +
          'Deploy apps-script/Code.gs to that Apps Script project (Deploy > New deployment > ' +
          'Web app > Execute as Me > Who has access: Anyone), run setupSheets(), then verify ' +
          'with: npm run bridge:check',
        payload,
        'protocol_mismatch'
      );
    }

    const message = raw || 'Google Apps Script returned an unsuccessful response';
    throw new AppsScriptError(message, payload, 'script_error');
  }
  throw new AppsScriptError('Google Apps Script returned an invalid (non-JSON) response', null, 'malformed_response');
};

const buildUrl = (action, params = {}) => {
  const url = new URL(env.appsScriptUrl);
  url.searchParams.set('action', action);
  url.searchParams.set('key', env.appsScriptApiKey);
  Object.entries(params).forEach(([name, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(name, String(value));
  });
  return url.toString();
};

/**
 * Legacy ("simple ERP") protocol support.
 *
 * A second, smaller Apps Script deployment speaks a different dialect:
 *   read   GET  ?action=get&table=Users        -> { success, data: [...] }
 *   write  POST { action: 'create'|'update', table, data, id }
 * It has no `key` guard and no HODs / Exams / Notifications / AuditLog sheets.
 * `APPS_SCRIPT_PROTOCOL=auto|bridge|legacy` selects the dialect; `auto` probes.
 */
const LEGACY_TABLES = {
  users: 'Users',
  students: 'Students',
  faculty: 'Faculty',
  hods: 'HODs',
  departments: 'Departments',
  subjects: 'Subjects',
  attendance: 'Attendance',
  materials: 'Materials',
  assignments: 'Assignments',
  assignment_submissions: 'AssignmentSubmissions',
  marks: 'Marks',
  timetable: 'Timetable',
  exams: 'Exams',
  announcements: 'Announcements',
  notifications: 'Notifications',
  audit_log: 'AuditLog',
};

// Tables the legacy deployment does not have at all. Failing loudly beats
// silently pretending an empty table exists.
const LEGACY_MISSING = new Set(['HODs', 'Exams', 'Notifications', 'AssignmentSubmissions', 'AuditLog']);

let protocol = (process.env.APPS_SCRIPT_PROTOCOL || 'auto').toLowerCase();

const detectProtocol = async () => {
  if (protocol !== 'auto') return protocol;
  // The legacy script answers a bare ?table=Users with its health message.
  try {
    const probe = await fetch(`${env.appsScriptUrl}?table=Users`, {
      headers: { Accept: 'application/json' },
    });
    const text = await probe.text();
    const isJson = /^\s*[{\[]/.test(text);
    if (isJson && /erp api is running/i.test(text)) protocol = 'legacy';
    else if (isJson) protocol = 'bridge';
  } catch {
    /* leave as auto; the real call below produces the actionable error */
  }
  if (protocol === 'auto') protocol = 'bridge';
  return protocol;
};

/**
 * Resolve the resource in a write action (`create_department`) to the sheet that
 * actually holds it. Deriving it by capitalising the token gives `Department`,
 * but the sheet is `Departments`, so the write lands on a table that does not
 * exist and every create/update fails with "Invalid table".
 */
const LEGACY_RESOURCE_TABLES = Object.entries(LEGACY_TABLES).reduce((acc, [action, table]) => {
  acc[action.toLowerCase()] = table;
  acc[action.toLowerCase().replace(/s$/, '')] = table;
  return acc;
}, {});

const legacyTableFor = (action) => {
  if (LEGACY_TABLES[action]) return LEGACY_TABLES[action];
  const resource = String(action).replace(/^(create|update|delete)_/, '').toLowerCase();
  if (LEGACY_RESOURCE_TABLES[resource]) return LEGACY_RESOURCE_TABLES[resource];
  return resource.charAt(0).toUpperCase() + resource.slice(1);
};

const buildHeaders = async () => {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (!googleAuth.isConfigured()) return headers;
  try {
    headers.Authorization = `Bearer ${await googleAuth.getAccessToken()}`;
  } catch (error) {
    // A bad key or clock skew must not look like a generic network failure.
    throw new AppsScriptError(
      `Google service-account authentication failed: ${error.message}. Check ` +
        'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in backend/.env and ' +
        "confirm the system clock is correct (JWTs fail if it is more than a few minutes off).",
      null,
      'google_auth_failed'
    );
  }
  return headers;
};

const request = async (method, action, { params = {}, payload = {} } = {}, attempt = 0) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const dialect = await detectProtocol();

  // --- legacy dialect: translate our action/params into ?action=get&table=X ---
  let url = buildUrl(action, params);
  let body = null;
  if (dialect === 'legacy') {
    if (method === 'GET') {
      const table = params.table || legacyTableFor(action);
      if (LEGACY_MISSING.has(table)) {
        clearTimeout(timer);
        throw new AppsScriptError(
          `The connected Apps Script deployment has no "${table}" sheet, so ${action} are ` +
            'unavailable. This deployment only provides Users, Students, Faculty, Departments, ' +
            'Subjects, Attendance, Materials, Assignments, Marks, Timetable and Announcements. ' +
            'Deploy apps-script/Code.gs to support ' +
            `${table}.`,
          { table },
          'table_not_supported'
        );
      }
      const legacyUrl = new URL(env.appsScriptUrl);
      legacyUrl.searchParams.set('action', 'get');
      legacyUrl.searchParams.set('table', table);
      Object.entries(params).forEach(([name, value]) => {
        if (name === 'table' || value === undefined || value === null || value === '') return;
        legacyUrl.searchParams.set(name, String(value));
      });
      url = legacyUrl.toString();
    } else {
      const verb = /^create/.test(action) ? 'create' : /^delete/.test(action) ? 'delete' : 'update';
      const table = payload.table || legacyTableFor(action);
      // This deployment has no AuditLog / HODs sheet. Every route records an
      // audit entry after it mutates, so posting one used to reject the whole
      // request with 502 *after* the real write had already succeeded. A
      // side-car log that cannot be stored must not fail the primary write.
      if (verb === 'update' && LEGACY_MISSING.has(table) && !payload.id) {
        clearTimeout(timer);
        return { success: true, message: `No "${table}" sheet in this deployment; entry skipped.`, data: null };
      }
      body = { action: verb, table, data: payload.record };
      if (payload.id) body.id = String(payload.id);
    }
  }

  try {
    // A write invalidates every cached read. Bump before issuing it so a read
    // already in flight cannot land back in the cache as if it were current.
    if (method !== 'GET') cacheEpoch.bump();
    const options = {
      method,
      signal: controller.signal,
      headers: await buildHeaders(),
    };
    if (body) options.body = JSON.stringify(body);
    else if (method !== 'GET') options.body = JSON.stringify({ action, key: env.appsScriptApiKey, ...payload });
    const response = await fetch(url, options);

    // A revoked or expired service-account token must not surface as a plain 401:
    // drop the cached token and retry once with a freshly minted one.
    if (response.status === 401 && googleAuth.isConfigured() && attempt === 0) {
      googleAuth.invalidate();
      clearTimeout(timer);
      return request(method, action, { params, payload }, attempt + 1);
    }

    // Google redirects an unauthenticated call to the sign-in page. Detect that
    // from the response URL, before reading the (slow, large) HTML body, so the
    // caller gets an accurate error instead of a timeout.
    const finalUrl = String(response.url || '');
    if (/accounts\.google\.com|\/ServiceLogin|signin/i.test(finalUrl)) {
      throw new AppsScriptError(
        googleAuth.isConfigured()
          ? 'Google Apps Script redirected us to a sign-in page even with a service-account token. ' +
              'The service account is not authorised: share the Apps Script project with it ' +
              '(Project Settings > Share) and share the spreadsheet with it too.'
          : 'Google Apps Script redirected us to a Google sign-in page, so the web app ' +
              'deployment is not public. In Apps Script open Deploy > Manage deployments > ' +
              'Edit (pencil icon) > set "Who has access: Anyone" > Save, then create a NEW ' +
              'deployment version. "Anyone with Google account" is not sufficient. If your domain ' +
              'forbids public web apps, set GOOGLE_SERVICE_ACCOUNT_EMAIL and ' +
              'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in backend/.env instead (see DEPLOYMENT.md).',
        { finalUrl, httpStatus: response.status },
        'sign_in_required'
      );
    }

    const text = await response.text();

    // A refused call comes back as an HTML page. Diagnose it before trying to
    // parse, otherwise every deployment problem looks like broken JSON.
    const looksLikeHtml = /^\s*(<!doctype|<html)/i.test(text);
    if (looksLikeHtml) {
      const diagnosis = diagnoseHtml(text);
      throw new AppsScriptError(diagnosis.message, { raw: text.slice(0, 400), httpStatus: response.status }, diagnosis.reason);
    }

    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        const diagnosis = diagnoseHtml(text);
        throw new AppsScriptError(diagnosis.message, { raw: text.slice(0, 400), httpStatus: response.status }, diagnosis.reason);
      }
    }

    if (!response.ok) {
      // Google intermittently 404s this deployment, and the legacy dialect
      // rejects our action names outright. Both mean "wrong dialect", so switch
      // and retry once instead of surfacing a confusing error.
      const body = String(text || '');
      if (dialect !== 'legacy' && attempt === 0 && (response.status === 404 || /invalid get action/i.test(body))) {
        protocol = 'legacy';
        clearTimeout(timer);
        return request(method, action, { params, payload }, attempt + 1);
      }

      // JSON came back, so the bridge itself answered with an error status.
      throw new AppsScriptError(
        parsed && (parsed.message || parsed.error)
          ? parsed.message || parsed.error
          : `Google Apps Script request failed with HTTP ${response.status}`,
        parsed,
        response.status === 401 || response.status === 403 ? 'unauthorized' : 'http_error'
      );
    }

    if (!parsed) {
      throw new AppsScriptError('Google Apps Script returned an empty response', null, 'empty_response');
    }

    // The legacy script rejects an action name it does not know with HTTP 200 and
    // a plain "Invalid GET action" message, so the !response.ok branch above can
    // never see it. When auto-detection picked the wrong dialect — its probe is
    // inconclusive whenever the deployment answers with a Google error page — this
    // message is the only signal, so switch dialect and retry once.
    if (dialect !== 'legacy' && attempt === 0 && typeof parsed === 'object') {
      const raw = String(parsed.message || parsed.error || '');
      if (/invalid (get|post) action/i.test(raw)) {
        protocol = 'legacy';
        clearTimeout(timer);
        return request(method, action, { params, payload }, attempt + 1);
      }
    }

    return normalizeResponse(parsed);
  } catch (error) {
    if (error instanceof AppsScriptError) throw error;
    if (error.name === 'AbortError') {
      throw new AppsScriptError('Timed out while contacting Google Apps Script. Please try again.', null, 'timeout');
    }
    throw new AppsScriptError('Unable to reach Google Apps Script. Please try again later.', null, 'network_error');
  } finally {
    clearTimeout(timer);
  }
};

const appsScript = {
  /** Read one or more sheet tables in a single call (batch read). */
  get: (action, params = {}) => request('GET', action, { params }).then((r) => r.data),
  /**
   * Execute a write / action operation.
   * `actor` is the authenticated user, passed so the Apps Script can re-check
   * department authority before writing. It is never read from the request body.
   */
  post: (action, payload = {}, actor) =>
    request('POST', action, { payload: actor ? { ...payload, actor } : payload }).then((r) => r),
  raw: request,
};

module.exports = appsScript;
module.exports.AppsScriptError = AppsScriptError;