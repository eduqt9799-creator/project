/**
 * Keeps the material row defaults in `src/routes/materials.js` in place.
 *
 *   npm run fix:materials
 *
 * `beforeCreate` must stamp `uploadDate` (mirroring `uploadedDate`) and a
 * `status` of "active" on every new material row. Without them the sheet
 * receives rows with an empty status, and the list filters that expect a
 * status silently drop them.
 *
 * The patch is idempotent and line-based: each default is inserted on its own
 * if missing, an existing line is left untouched, and the file is only written
 * when something actually changed. The result is parsed with `node --check`
 * before it is saved, so a bad edit can never land on disk.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'src', 'routes', 'materials.js');

// The line the defaults hang off, and the lines to guarantee after it.
const ANCHOR = '      data.uploadedDate = data.uploadedDate || new Date().toISOString().slice(0, 10);';
const DEFAULTS = [
  '      data.uploadDate = data.uploadDate || data.uploadedDate;',
  "      data.status = data.status || 'active';",
];

/** Confirms the candidate source still parses before it replaces the real file. */
const parses = (source, label) => {
  const scratch = path.join(require('os').tmpdir(), `materials-${process.pid}-${label}.js`);
  try {
    fs.writeFileSync(scratch, source);
    execFileSync(process.execPath, ['--check', scratch], { stdio: 'pipe' });
    return true;
  } catch (error) {
    const detail = error.stderr ? error.stderr.toString().trim() : error.message;
    process.stderr.write(`Refusing to write: the patched file does not parse.\n${detail}\n`);
    return false;
  } finally {
    fs.rmSync(scratch, { force: true });
  }
};

const patch = () => {
  const original = fs.readFileSync(TARGET, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);

  const anchorIndex = lines.findIndex((line) => line.trim() === ANCHOR.trim());
  if (anchorIndex === -1) {
    process.stderr.write(
      `Could not find the anchor line in materials.js:\n  ${ANCHOR}\n` +
        'beforeCreate has been reshaped since this script was written; update the anchor here.\n'
    );
    return 1;
  }

  // Insert in reverse so each index stays valid as we splice.
  const missing = DEFAULTS.filter((line) => !lines.some((existing) => existing.trim() === line.trim()));
  for (let i = 0; i < missing.length; i += 1) {
    lines.splice(anchorIndex + 1 + i, 0, missing[i]);
  }

  if (!missing.length) {
    process.stdout.write('materials.js already stamps uploadDate and status. Nothing to do.\n');
    return 0;
  }

  const patched = lines.join(eol);
  if (!parses(patched, 'patched')) return 1;

  fs.writeFileSync(TARGET, patched);
  process.stdout.write(`Added ${missing.length} default(s) to beforeCreate in materials.js:\n`);
  for (const line of missing) process.stdout.write(`  ${line.trim()}\n`);
  return 0;
};

try {
  process.exitCode = patch();
} catch (error) {
  process.stderr.write(`patch-materials-defaults failed: ${error.message}\n`);
  process.exitCode = 1;
}