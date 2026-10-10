const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const HMAC_PREFIX = 'hmac-sha256$';
const MAX_HMAC_ITERATIONS = 200000;

/**
 * Verifies a stored password hash.
 *
 * Two formats are supported:
 *  - bcrypt (`$2a$` / `$2b$` / `$2y$`) - used for every account created by the
 *    backend.
 *  - `hmac-sha256$<iterations>$<salt>$<digest>` - produced by the Apps Script
 *    bootstrap helper, because Apps Script cannot run bcrypt. It is an
 *    iterated HMAC-SHA256 KDF and is only ever created once for the first
 *    administrator; changing that password rewrites it as bcrypt.
 */
const verifyPassword = async (plain, storedHash) => {
  const hash = String(storedHash || '');
  if (!hash) return false;

  if (!hash.startsWith(HMAC_PREFIX)) {
    if (!/^\$2[aby]\$/.test(hash)) return false;
    return bcrypt.compare(String(plain), hash);
  }

  const parts = hash.split('$');
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > MAX_HMAC_ITERATIONS) return false;
  if (!salt || !expected) return false;

  let digest = hmac_(String(plain), salt);
  for (let i = 1; i < iterations; i += 1) digest = hmac_(digest, salt);

  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const hmac_ = (value, salt) =>
  crypto
    .createHmac('sha256', salt)
    .update(String(value), 'ascii')
    .digest('base64');

/**
 * Verifies a password against the legacy deployment, which stores the password
 * as plain text in the sheet. This is a real downgrade in protection — the hash
 * is what stops a leaked sheet from revealing passwords — so it is opt-in via
 * APPS_SCRIPT_ALLOW_LEGACY_PLAINTEXT and must not become the default.
 */
const ALLOW_LEGACY_PLAINTEXT =
  String(process.env.APPS_SCRIPT_ALLOW_LEGACY_PLAINTEXT || '').toLowerCase() === 'true';

const verifyPasswordLegacyAware = async (plain, storedHash) => {
  const hash = String(storedHash || '');
  if (!hash) return false;
  if (hash.startsWith(HMAC_PREFIX) || /^\$2[aby]\$/.test(hash)) return verifyPassword(plain, hash);
  if (!ALLOW_LEGACY_PLAINTEXT) return false;
  const a = Buffer.from(String(plain), 'utf8');
  const b = Buffer.from(hash, 'utf8');
  // Lengths can differ, which timingSafeEqual rejects; that is a wrong password.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { verifyPassword, verifyPasswordLegacyAware, isLegacyPlaintextAllowed: () => ALLOW_LEGACY_PLAINTEXT };