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
const { verifyPassword } = require('../src/services/passwordHash');

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

// --------------------------------------------------------------- bootstrap admin

const bootstrapAdminIsUsable = async () => {
  const sheets = {};
  const ctx = loadCode(CODE_GS, sheets);
  ctx.setupSheets();
  const message = ctx.createInitialAdmin_('admin9799@gmail.com', 'Administrator', 'pass@9799');
  assert.match(message, /admin9799@gmail\.com/, 'the helper must report the created email');

  const admins = ctx.readSheet_('Users').filter((u) => String(u.role).toLowerCase() === 'admin');
  assert.strictEqual(admins.length, 1, 'exactly one admin row must be written');
  assert.strictEqual(admins[0].email, 'admin9799@gmail.com');
  assert.strictEqual(admins[0].status, 'active');
  assert.ok(String(admins[0].passwordHash).startsWith('hmac-sha256$'), 'the bootstrap hash must use the documented format');
  // The whole point: the backend must accept this hash for the given password.
  assert.ok(await verifyPassword('pass@9799', admins[0].passwordHash), 'the bootstrap password must verify');
  assert.ok(!(await verifyPassword('wrong-password', admins[0].passwordHash)), 'a wrong password must be rejected');
};

const bootstrapAdminDefaultsToTheProjectAdmin = async () => {
  const sheets = {};
  const ctx = loadCode(CODE_GS, sheets);
  ctx.setupSheets();
  const message = ctx.createInitialAdmin_();
  assert.match(message, /admin9799@gmail\.com/);
  const admin = ctx.readSheet_('Users')[0];
  assert.ok(await verifyPassword('pass@9799', admin.passwordHash), 'the default password must verify');
};

const bootstrapAdminRefusesWhenOneExists = async () => {
  const sheets = {};
  const ctx = loadCode(CODE_GS, sheets);
  ctx.setupSheets();
  ctx.createInitialAdmin_();
  const second = ctx.createInitialAdmin_('other@college.edu', 'Other', 'another-pass');
  assert.match(second, /already exists/i, 'a second run must be refused, not overwrite the live admin');
  assert.strictEqual(ctx.readSheet_('Users').filter((u) => String(u.role).toLowerCase() === 'admin').length, 1);
};

// ------------------------------------------------------------ single department

/**
 * A spreadsheet that predates the single-department deployment: two department
 * rows (CSE, ECE) and rows in several tables still carrying the old values.
 */
const withLegacyDepartments = () => {
  const sheets = {};
  const ctx = loadCode(CODE_GS, sheets);
  ctx.setupSheets();
  ctx.createRows_('Departments', [
    { departmentId: 'CSE', departmentCode: 'CSE', departmentName: 'Computer Science', status: 'active' },
    { departmentId: 'ECE', departmentCode: 'ECE', departmentName: 'Electronics', status: 'active' },
  ]);
  ctx.createRows_('Students', [{
    studentId: 'STU-1', registerNumber: 'STU-001', name: 'Asha', email: 'asha@college.edu',
    semester: 3, departmentId: 'CSE', departmentName: 'Computer Science', status: 'active',
  }]);
  ctx.createRows_('Faculty', [{
    facultyId: 'FAC-1', employeeId: 'FAC-001', name: 'Ravi', email: 'ravi@college.edu',
    departmentId: 'ECE', departmentName: 'Electronics', status: 'active',
  }]);
  ctx.createRows_('Users', [
    { userId: 'USR-ADMIN', name: 'Admin', email: 'admin@college.edu', role: 'admin', departmentId: '', departmentName: '', status: 'active' },
    { userId: 'USR-ASHA', name: 'Asha', email: 'asha@college.edu', role: 'student', departmentId: 'CSE', departmentName: 'Computer Science', status: 'active' },
  ]);
  return ctx;
};

const migrationCollapsesDepartmentsToSingleRow = () => {
  const ctx = withLegacyDepartments();
  const report = ctx.ensureSingleDepartment_();
  assert.strictEqual(report.departmentId, 'CS01');
  const depts = ctx.readSheet_('Departments');
  assert.strictEqual(depts.length, 1, 'exactly one department row may remain');
  assert.strictEqual(depts[0].departmentId, 'CS01');
  assert.strictEqual(depts[0].departmentCode, 'CS01');
  assert.strictEqual(depts[0].departmentName, 'Computer Science and Engineering');
  assert.strictEqual(depts[0].status, 'active');
  assert.strictEqual(report.departmentRowsRemoved, 2, 'both legacy department rows are removed');
};

const migrationReassignsDepartmentScopedRows = () => {
  const ctx = withLegacyDepartments();
  ctx.ensureSingleDepartment_();
  const student = ctx.readSheet_('Students')[0];
  assert.strictEqual(student.departmentId, 'CS01');
  assert.strictEqual(student.departmentName, 'Computer Science and Engineering');
  assert.strictEqual(student.semester, 3, 'unrelated columns are preserved');
  assert.strictEqual(student.name, 'Asha');
  const faculty = ctx.readSheet_('Faculty')[0];
  assert.strictEqual(faculty.departmentId, 'CS01');
  assert.strictEqual(faculty.departmentName, 'Computer Science and Engineering');
};

const migrationLeavesAdminsDepartmentless = () => {
  const ctx = withLegacyDepartments();
  ctx.ensureSingleDepartment_();
  const users = ctx.readSheet_('Users');
  const admin = users.find((u) => String(u.role).toLowerCase() === 'admin');
  const studentUser = users.find((u) => String(u.role).toLowerCase() === 'student');
  assert.strictEqual(admin.departmentId, '', 'admin stays department-less');
  assert.strictEqual(admin.departmentName, '');
  assert.strictEqual(studentUser.departmentId, 'CS01', 'non-admin users are reassigned to CS01');
  assert.strictEqual(studentUser.departmentName, 'Computer Science and Engineering');
};

const migrationIsIdempotent = () => {
  const ctx = withLegacyDepartments();
  ctx.ensureSingleDepartment_();
  const before = JSON.stringify(ctx.readSheet_('Students'));
  const second = ctx.ensureSingleDepartment_();
  assert.strictEqual(second.usersReassigned + second.rowsReassigned, 0, 'a second run must not rewrite already-canonical rows');
  assert.strictEqual(JSON.stringify(ctx.readSheet_('Students')), before, 'a second run must leave rows untouched');
  assert.strictEqual(ctx.readSheet_('Departments').length, 1);
};

const migrateBridgeActionRunsFromDoPost = () => {
  const ctx = withLegacyDepartments();
  const post = () => ctx.doPost({
    postData: { contents: JSON.stringify({ action: 'migrate_single_department', key: 'test-key' }) },
  });
  post();
  const payload = JSON.parse(ctx.__lastOutput);
  assert.strictEqual(payload.success, true, 'the bridge action answers success');
  assert.strictEqual(payload.data.departmentId, 'CS01');
  assert.strictEqual(ctx.readSheet_('Departments').length, 1);
  assert.strictEqual(ctx.readSheet_('Students')[0].departmentId, 'CS01');
  // Idempotent through the same path.
  post();
  assert.strictEqual(ctx.readSheet_('Departments').length, 1);
  assert.strictEqual(ctx.readSheet_('Departments')[0].departmentId, 'CS01');
  assert.strictEqual(ctx.readSheet_('Students')[0].departmentId, 'CS01');
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
  ['createInitialAdmin_ writes a login the backend accepts', bootstrapAdminIsUsable],
  ['createInitialAdmin_ defaults to the project admin', bootstrapAdminDefaultsToTheProjectAdmin],
  ['createInitialAdmin_ refuses a second admin', bootstrapAdminRefusesWhenOneExists],
  ['single-department migration collapses Departments to one canonical row', migrationCollapsesDepartmentsToSingleRow],
  ['single-department migration reassigns every department-scoped row', migrationReassignsDepartmentScopedRows],
  ['single-department migration leaves admins department-less', migrationLeavesAdminsDepartmentless],
  ['single-department migration is idempotent', migrationIsIdempotent],
  ['migrate_single_department runs through doPost', migrateBridgeActionRunsFromDoPost],
];

const main = async () => {
  let failed = 0;
  for (const [name, test] of tests) {
    try {
      await test();
      process.stdout.write(`ok   ${name}\n`);
    } catch (error) {
      failed += 1;
      process.stdout.write(`FAIL ${name}\n     ${error.message}\n`);
    }
  }
  process.stdout.write(`\n${tests.length - failed}/${tests.length} schema migration checks passed.\n`);
  process.exit(failed ? 1 : 0);
};

main();