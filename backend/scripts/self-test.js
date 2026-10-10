/**
 * Lightweight self-tests for the pure helpers that carry security and
 * scheduling rules. No test framework required: npm test
 */
const assert = require('assert');
const bcrypt = require('bcryptjs');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-012345678901234567890123';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
process.env.APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/FAKE/exec';

const { verifyPassword } = require('../src/services/passwordHash');
const { computeAssignmentStatus } = require('../src/services/assignmentStatus');
const { naturalCompare, byRegisterNumber } = require('../src/utils/naturalSort');
const { toBool } = require('../src/services/dataService');
const { withoutPassword, SPECS, validate } = require('../src/utils/validate');
const { toCsv } = require('../src/routes/reports');

const hmacHash = (plain, salt, iterations) => {
  const crypto = require('crypto');
  let digest = crypto.createHmac('sha256', salt).update(plain, 'ascii').digest('base64');
  for (let i = 1; i < iterations; i += 1) {
    digest = crypto.createHmac('sha256', salt).update(digest, 'ascii').digest('base64');
  }
  return `hmac-sha256$${iterations}$${salt}$${digest}`;
};

const run = async () => {
  // ---------------------------------------------------------------- passwords
  const bcryptHash = await bcrypt.hash('a-strong-password', 10);
  assert.ok(await verifyPassword('a-strong-password', bcryptHash), 'bcrypt hash must verify');
  assert.ok(!(await verifyPassword('wrong-password', bcryptHash)), 'bcrypt hash must reject a wrong password');

  const bootstrap = hmacHash('a-strong-password', 'salt123', 2000);
  assert.ok(await verifyPassword('a-strong-password', bootstrap), 'bootstrap hmac hash must verify');
  assert.ok(!(await verifyPassword('wrong-password', bootstrap)), 'bootstrap hmac hash must reject a wrong password');
  assert.ok(!(await verifyPassword('anything', '')), 'empty hash must reject every password');
  assert.ok(!(await verifyPassword('anything', 'plain-text-password')), 'plain-text hash must reject every password');
  assert.ok(!(await verifyPassword('anything', 'hmac-sha256$999999999$salt$digest')), 'absurd iteration count must reject');

  // -------------------------------------------------------- assignment status
  const row = { assignedDate: '2026-01-01', dueDate: '2026-06-30', status: 'active' };
  assert.strictEqual(computeAssignmentStatus(row, new Date('2026-02-01')), 'pending');
  assert.strictEqual(computeAssignmentStatus(row, new Date('2026-07-01')), 'overdue');
  assert.strictEqual(computeAssignmentStatus({ ...row, dueDate: '' }, new Date('2026-07-01')), 'pending');

  // A student's own submission always wins, and never affects other students.
  const submission = { assignmentId: 'ASG-1', studentId: 'STU-1', status: 'submitted' };
  assert.strictEqual(computeAssignmentStatus(row, new Date('2026-07-01'), submission), 'submitted');
  assert.strictEqual(computeAssignmentStatus(row, new Date('2026-07-01'), null), 'overdue');
  assert.strictEqual(
    computeAssignmentStatus(row, new Date('2026-02-01'), { ...submission, status: 'withdrawn' }),
    'pending',
    'a withdrawn submission falls back to the date-derived status'
  );

  // --------------------------------------------------------------- sorting
  const sorted = ['STU-10', 'STU-2', 'STU-1'].sort(naturalCompare);
  assert.deepStrictEqual(sorted, ['STU-1', 'STU-2', 'STU-10']);
  const byRegister = [
    { registerNumber: 'STU-010' },
    { registerNumber: 'STU-002' },
    { registerNumber: 'STU-001' },
  ].sort(byRegisterNumber);
  assert.deepStrictEqual(byRegister.map((s) => s.registerNumber), ['STU-001', 'STU-002', 'STU-010']);

  // ------------------------------------------------------- sheet booleans
  assert.strictEqual(toBool('TRUE'), true);
  assert.strictEqual(toBool('true'), true);
  assert.strictEqual(toBool(true), true);
  assert.strictEqual(toBool('FALSE'), false);
  assert.strictEqual(toBool(''), false);
  assert.strictEqual(toBool(undefined), false);
  assert.strictEqual(toBool('anything-else'), false);

  // ------------------------------------------- update specs drop passwords
  for (const key of ['student', 'faculty', 'hod', 'adminUser']) {
    assert.ok(SPECS[key] && SPECS[key].password, `${key} spec must require a password on create`);
    assert.ok(!withoutPassword(SPECS[key]).password, `${key} update spec must not require a password`);
    assert.ok(Object.keys(withoutPassword(SPECS[key])).length > 0, `${key} update spec must keep other fields`);
  }
  assert.ok(SPECS.notification.title.required, 'notification title must be required');
  assert.ok(SPECS.attendance.subjectCode.required, 'attendance subjectCode must be required');

  // ------------------------------------------------- subject allocations
  const allocation = { subjectCode: 'CS3A', semester: 3, departmentId: 'CSE', facultyId: 'FAC-1' };
  const allocErrors = validate(allocation, SPECS.subjectAllocation);
  assert.deepStrictEqual(allocErrors.errors, {}, 'a complete allocation must validate');
  assert.strictEqual(allocErrors.data.subjectCode, 'CS3A');

  const missing = validate({ semester: 3 }, SPECS.subjectAllocation);
  assert.ok(missing.errors.facultyId, 'an allocation without a faculty member must be rejected');
  assert.ok(missing.errors.subjectCode, 'an allocation without a subject must be rejected');

  // Lower-casing the code must still resolve to the same subject, so a
  // re-submitted form cannot create a second row for the same subject.
  assert.strictEqual(
    validate({ ...allocation, subjectCode: 'cs3a' }, SPECS.subjectAllocation).data.subjectCode,
    'CS3A',
    'subject codes must be normalised to upper case before duplicate checks'
  );
  assert.ok(
    validate({ ...allocation, semester: 99 }, SPECS.subjectAllocation).errors.semester,
    'semesters outside 1-10 must be rejected'
  );

  // ------------------------------------------------------------- reports
  const csv = toCsv(['registerNumber', 'name'], [
    { registerNumber: 'STU-001', name: 'Asha' },
    { registerNumber: 'STU-002', name: 'Ravi, Jr' },
    { registerNumber: 'STU-003', name: 'He said "hi"' },
  ]);
  assert.ok(csv.charCodeAt(0) === 0xfeff, 'a CSV export must start with a UTF-8 BOM so Excel reads it correctly');
  assert.ok(csv.includes('registerNumber,name'), 'the header row must list the report columns');
  assert.ok(csv.includes('"Ravi, Jr"'), 'a value containing a comma must be quoted');
  assert.ok(csv.includes('"He said ""hi"""'), 'an embedded quote must be doubled');
  assert.ok(csv.endsWith('\r\n'), 'a CSV export must end with a line break');

  const { visibleTo } = require('../src/routes/materials');
  const student = { role: 'student', profile: { semester: 3 } };
  assert.ok(visibleTo({ semester: 3, visibility: 'all' }, student, { semester: 3 }), 'a student sees their own semester');
  assert.ok(!visibleTo({ semester: 5, visibility: 'all' }, student, { semester: 3 }), 'a student must not see another semester');
  assert.ok(!visibleTo({ semester: 3, visibility: 'hod' }, student, { semester: 3 }), 'a student must not see staff-only material');
  const teacher = { role: 'faculty' };
  assert.ok(
    visibleTo({ subjectCode: 'CS3A', facultyId: 'FAC-2' }, teacher, { facultyId: 'FAC-1', allocatedCodes: new Set(['CS3A']) }),
    'a faculty member sees material for an allocated subject'
  );
  assert.ok(
    !visibleTo({ subjectCode: 'CS9Z', facultyId: 'FAC-2' }, teacher, { facultyId: 'FAC-1', allocatedCodes: new Set(['CS3A']) }),
    'a faculty member must not see material for a subject they are not allocated to'
  );
  assert.ok(
    visibleTo({ subjectCode: 'CS3A', facultyId: 'FAC-1' }, teacher, { facultyId: 'FAC-1', allocatedCodes: new Set() }),
    'a faculty member always sees their own upload'
  );

  // ------------------------------------------ semester / subject ordering
  const bySemesterThenCode = require('../src/utils/subjectOrder').bySemesterThenCode;
  const ordered = [
    { semester: 10, subjectCode: 'CS1A' },
    { semester: 2, subjectCode: 'CS10A' },
    { semester: 2, subjectCode: 'CS2A' },
  ].sort(bySemesterThenCode);
  assert.deepStrictEqual(
    ordered.map((s) => `${s.semester}:${s.subjectCode}`),
    ['2:CS2A', '2:CS10A', '10:CS1A'],
    'subjects must sort by semester, then naturally by code'
  );

  process.stdout.write('All assertions passed.\n');
};

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});