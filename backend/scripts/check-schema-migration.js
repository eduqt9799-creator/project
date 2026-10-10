/**
 * Header/column migration tests for apps-script/Code.gs.
 *
 *   node scripts/check-schema-migration.js
 *
 * The bug this guards against: `setupSheets()` used to rewrite the header row
 * *positionally*. The data rows do not move with the header, so every existing
 * row silently ended up under the wrong column label — a student's `status`
 * read back `createdAt`'s value, and `batch` came back blank because the column
 * did not exist yet. Columns are now appended, and every read/write resolves its
 * position by header NAME rather than by SCHEMA index.
 *
 * Code.gs runs on Apps Script, so these tests load it into a sandbox with a fake
 * Spreadsheet service (see gas-harness.js) rather than hitting Google.
 */
const assert = require('assert');
const path = require('path');
const { FakeSheet, loadCode } = require('./gas-harness');

const CODE_GS = path.join(__dirname, '..', '..', 'apps-script', 'Code.gs');

/** The column order Code.gs declares for Students. */
const STUDENTS_SCHEMA = [
  'studentId', 'registerNumber', 'name', 'email', 'phone', 'semester',
  'departmentId', 'departmentName', 'batch', 'status', 'createdAt', 'updatedAt',
];

const STUDENT_ROW = {
  studentId: 'STU-1',
  registerNumber: 'STU-001',
  name: 'Asha',
  email: 'asha@college.edu',
  phone: '9000000000',
  semester: 3,
  departmentId: 'CSE',
  departmentName: 'Computer Science',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * A spreadsheet created before `batch` existed: the declared schema minus
 * `batch`, holding one real student. This is the state that made Batch and
 * Semester render blank in the UI.
 */
function legacyStudentsSheet(columns = STUDENTS_SCHEMA.filter((h) => h !== 'batch')) {
  const sheet = new FakeSheet('Students');
  columns.forEach((h, i) => { sheet._ensure(0, i)[i] = h; });
  columns.forEach((h, i) => { sheet._ensure(1, i)[i] = STUDENT_ROW[h]; });
  return sheet;
}

const headerOf = (sheet) => sheet.cells[0].map((v) => String(v === null || v === undefined ? '' : v).trim());

// --------------------------------------------------------------------- reads

const readKeepsExistingRowsAligned = () => {
  const ctx = loadCode(CODE_GS, { Students: legacyStudentsSheet() });
  const row = ctx.readSheet_('Students')[0];
  // The regression: `status` used to pick up `createdAt`'s value.
  assert.strictEqual(row.status, 'active', 'status must not read createdAt');
  assert.strictEqual(row.createdAt, STUDENT_ROW.createdAt, 'createdAt must be unchanged');
  assert.strictEqual(row.semester, 3, 'semester must not shift');
  assert.strictEqual(row.name, 'Asha');
  assert.strictEqual(row.registerNumber, 'STU-001');
};

const missingColumnReadsEmptyNotUndefined = () => {
  const ctx = loadCode(CODE_GS, { Students: legacyStudentsSheet() });
  const row = ctx.readSheet_('Students')[0];
  assert.ok('batch' in row, 'a declared column must still be present on the row');
  assert.strictEqual(row.batch, '', 'a column the sheet lacks must read as empty, not undefined');
};

// ----------------------------------------------------------------- migration

const setupAppendsInsteadOfRewriting = () => {
  const sheet = legacyStudentsSheet();
  const before = sheet.cells[0].slice();
  const ctx = loadCode(CODE_GS, { Students: sheet });
  ctx.setupSheets();
  const header = headerOf(sheet);
  before.forEach((h, i) => {
    assert.strictEqual(header[i], h, `header at position ${i} must not move (got "${header[i]}")`);
  });
  assert.strictEqual(header[header.length - 1], 'batch', 'the new column must be appended at the end');
};

const migrationPreservesExistingData = () => {
  const sheet = legacyStudentsSheet();
  const ctx = loadCode(CODE_GS, { Students: sheet });
  ctx.setupSheets();
  const row = ctx.readSheet_('Students')[0];
  Object.keys(STUDENT_ROW).forEach((field) => {
    assert.strictEqual(String(row[field]), String(STUDENT_ROW[field]), `${field} must survive the migration`);
  });
  assert.strictEqual(row.batch, '');
};

const setupIsIdempotent = () => {
  const sheet = legacyStudentsSheet();
  const ctx = loadCode(CODE_GS, { Students: sheet });
  ctx.setupSheets();
  const afterFirst = sheet.cells[0].join('|');
  ctx.setupSheets();
  assert.strictEqual(sheet.cells[0].join('|'), afterFirst, 'a second run must not touch the header row');
};

const freshSheetGetsFullSchema = () => {
  const sheets = {};
  const ctx = loadCode(CODE_GS, sheets);
  ctx.setupSheets();
  assert.deepStrictEqual(headerOf(sheets.Students), STUDENTS_SCHEMA);
};

// -------------------------------------------------------------------- writes

const updateHitsTheRightColumns = () => {
  const sheet = legacyStudentsSheet();
  const ctx = loadCode(CODE_GS, { Students: sheet });
  ctx.setupSheets();
  ctx.updateRow_('Students', 'STU-1', { batch: '2022', status: 'inactive' });
  const row = ctx.readSheet_('Students')[0];
  assert.strictEqual(row.batch, '2022');
  assert.strictEqual(row.status, 'inactive');
  assert.strictEqual(row.semester, 3, 'an unrelated column must not be disturbed');
  assert.strictEqual(row.name, 'Asha');
};

const appendPlacesEveryField = () => {
  const sheet = legacyStudentsSheet();
  const ctx = loadCode(CODE_GS, { Students: sheet });
  ctx.setupSheets();
  ctx.appendRows_('Students', [{
    ...STUDENT_ROW,
    studentId: 'STU-2',
    registerNumber: 'STU-002',
    name: 'Ravi',
    semester: 5,
    batch: '2024',
  }]);
  const row = ctx.readSheet_('Students').find((r) => r.studentId === 'STU-2');
  assert.ok(row, 'the appended row must be readable');
  assert.strictEqual(row.semester, 5);
  assert.strictEqual(row.batch, '2024');
  assert.strictEqual(row.name, 'Ravi');
};

const reorderedColumnsStillResolveByName = () => {
  // Somebody dragged `semester` to the far right by hand.
  const order = [...STUDENTS_SCHEMA.filter((h) => h !== 'semester'), 'semester'];
  const sheet = legacyStudentsSheet(order);
  const ctx = loadCode(CODE_GS, { Students: sheet });
  assert.strictEqual(ctx.readSheet_('Students')[0].semester, 3, 'reads must resolve by name, not position');

  ctx.updateRow_('Students', 'STU-1', { semester: 8 });
  const row = ctx.readSheet_('Students')[0];
  assert.strictEqual(row.semester, 8, 'an update must hit the semester column wherever it lives');
  assert.strictEqual(row.name, 'Asha');
};

const deleteResolvesPrimaryKeyByName = () => {
  const sheet = legacyStudentsSheet();
  const ctx = loadCode(CODE_GS, { Students: sheet });
  ctx.setupSheets();
  ctx.deleteRow_('Students', 'STU-1');
  assert.strictEqual(ctx.readSheet_('Students').length, 0);
};

const upsertUpdatesInPlace = () => {
  const sheet = legacyStudentsSheet();
  const ctx = loadCode(CODE_GS, { Students: sheet });
  ctx.setupSheets();
  // The patch carries no primary key: the id must come from the matched row.
  ctx.upsertBy_('Students', ['registerNumber'], { registerNumber: 'STU-001', batch: '2023' });
  const rows = ctx.readSheet_('Students');
  assert.strictEqual(rows.length, 1, 'must update in place, never append a duplicate');
  assert.strictEqual(rows[0].batch, '2023');
  assert.strictEqual(rows[0].semester, 3);
};

const tests = [
  ['reads keep existing rows aligned with their headers', readKeepsExistingRowsAligned],
  ['a column the sheet lacks reads empty, not undefined', missingColumnReadsEmptyNotUndefined],
  ['setupSheets appends instead of rewriting in place', setupAppendsInsteadOfRewriting],
  ['migration preserves every existing value', migrationPreservesExistingData],
  ['setupSheets is idempotent', setupIsIdempotent],
  ['a fresh sheet receives the full schema', freshSheetGetsFullSchema],
  ['updateRow_ writes to the correct columns', updateHitsTheRightColumns],
  ['appendRows_ places every declared field', appendPlacesEveryField],
  ['reordered columns still resolve by name', reorderedColumnsStillResolveByName],
  ['deleteRow_ resolves the primary key by name', deleteResolvesPrimaryKeyByName],
  ['upsertBy_ updates the matched row in place', upsertUpdatesInPlace],
];

let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    process.stdout.write(`ok   ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAIL ${name}\n     ${error.message}\n`);
  }
}

process.stdout.write(`\n${tests.length - failed}/${tests.length} schema migration checks passed.\n`);
process.exit(failed ? 1 : 0);