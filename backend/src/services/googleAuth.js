/**
 * Optional Google service-account authentication for the Apps Script bridge.
 *
 * Why this exists: some deployments cannot be shared with "Anyone" (managed
 * Google Workspace domains often forbid public web apps). Those deployments
 * answer anonymous calls with a Google sign-in page. When
 * GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY are set,
 * the backend signs its own JWT and presents an OAuth2 access token instead, so
 * the bridge is called as the service account rather than anonymously.
 *
 * Setup (one time, in Google Cloud + Apps Script):
 *   1. Create a service account and download its JSON key.
 *   2. Apps Script editor > Project Settings > Share > add the service account
 *      email as an editor (it needs permission to run the script).
 *   3. Share the spreadsheet with the same service account email.
 *   4. Put the email and PEM key in backend/.env.
 *
 * Without those variables the bridge is called anonymously, exactly as before.
 */
const crypto = require('crypto');

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/script.external_api';

// A minute of headroom so a token never expires mid-request.
const EXPIRY_MARGIN_MS = 60 * 1000;

let cache = null;

const readConfig = () => {
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';

  let privateKey = rawKey.replace(/\\n/g, '\n').trim();
  if ((!email || !privateKey) && json) {
    try {
      const parsed = JSON.parse(json);
      email = email || parsed.client_email || '';
      privateKey = privateKey || String(parsed.private_key || '').replace(/\\n/g, '\n');
    } catch {
      /* fall through to the not-configured path */
    }
  }
  if (!email || !privateKey) return null;
  return { email, privateKey };
};

const isConfigured = () => readConfig() !== null;

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const buildAssertion = ({ email, privateKey }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${claims}.${signature}`;
};

/** Returns a cached access token, minting a new one when needed. */
const getAccessToken = async () => {
  const config = readConfig();
  if (!config) return null;

  if (cache && cache.token && Date.now() < cache.expiresAt - EXPIRY_MARGIN_MS) {
    return cache.token;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildAssertion(config),
    }).toString(),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Google token endpoint returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Google token request failed (HTTP ${response.status})`);
  }

  cache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  };
  return cache.token;
};

/** Called after a 401 so the next attempt mints a fresh token. */
const invalidate = () => {
  cache = null;
};

module.exports = { isConfigured, getAccessToken, invalidate, email: () => readConfig()?.email || '', SCOPE };