/**
 * Parses every backend source file so a syntax error can never reach the
 * running server. Run with: npm run check
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const files = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
};

walk(root);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${path.relative(root, file)}\n${error.stderr ? error.stderr.toString() : error.message}\n`);
  }
}

if (failed) {
  process.stderr.write(`\n${failed} of ${files.length} file(s) failed to parse.\n`);
  process.exit(1);
}

process.stdout.write(`All ${files.length} backend source files parse cleanly.\n`);