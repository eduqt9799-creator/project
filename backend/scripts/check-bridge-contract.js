/**
 * Contract tests for apps-script/Code.gs.
 *
 *   node scripts/check-bridge-contract.js
 *
 * check-schema-migration.js proves the header/column migration is safe. This
 * proves the part the backend actually depends on: that every action name it
 * sends reaches the right sheet, that writes are gated by the API key, and that
 * a department cannot write into another department's rows.
 *
 * Code.gs runs on Apps Script, so it is loaded into a sandbox with a fake
 * Spreadsheet service (see gas-harness.js) rather than hitting Google.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { FakeSheet } = require('./gas-harness');

const CODE_GS = path.join(__dirname, '..', '..', 'apps-script', 'Code.gs');

const HOD = { userId: 'USR-1', role: 'hod', departmentId: 'CSE' };
const OTHER_HOD = { userId: 'USR-2', role: 'hod', departmentId: 'ECE' };
const ADMIN = { userId: 'USR-9', role: 'admin', departmentId: '' };

const CSV301 = {
  departmentId: 'CSE',
  departmentName: 'Computer Science',
  semester: 3,
  subjectCode: 'CS301',
  subjectName: 'DBMS',
  facultyId: 'FAC-1',
  facultyName: 'Asha',
  assignedDate: '2026-10-04',
  assignedBy: 'USR-1',
};

/**
 * A sandbox wired to its own spreadsheet, so no test can see another's rows.
 * `setup` runs setupSheets() unless the test needs the sheets to be missing.
 */
function fresh(options = {}) {
  const sheets = {};
  const store = { SPREADSHEET_ID: 'test-spreadsheet-id', API_KEY: 'test-key' };

  const sandbox = {
    console,
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (n) => sheets[n] || null,
        insertSheet: (n) => {
          sheets[n] = new FakeSheet(n);
          return sheets[n];
        },
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] }) },
    Utilities: { Charset: { US_ASCII: 'US_ASCII' } },
    // The shared harness stubs ContentService out; doGet/doPost need the body back.
    ContentService: {
      createTextOutput: () => {
        const out = {
          setMimeType() {
            return out;
          },
          setContent(value) {
            out.body = value;
            return out;
          },
          getContent() {
            return out.body;
          },
        };
        return out;
      },
      MimeType: { JSON: 'json' },
    },
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CODE_GS, 'utf8'), sandbox, { filename: CODE_GS });

  const ctx = {
    sheets,
    store,
    get: (action, key = 'test-key') => JSON.parse(sandbox.doGet({ parameter: { action, key } }).getContent()),
    post: (body) => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
    setup: () => ctx.get('setup_sheets'),
    /** The CSE allocation every allocation test starts from. */
    seed: () => ctx.post({ action: 'create_subject_allocation', key: 'test-key', actor: HOD, record: CSV301 }),
  };

  if (options.setup !== false) ctx.setup();
  return ctx;
}

// ---------------------------------------------------------------- key guard

const rejectsAWrongKey = () => {
  const ctx = fresh();
  const res = ctx.get('users', 'not-the-key');
  assert.strictEqual(res.success, false);
  assert.match(res.message, /Unauthorized/i);
};

const rejectsAMissingKey = () => {
  assert.strictEqual(fresh().get('users', '').success, false);
};

/** An unset Script Property must refuse everything, not fall open. */
const failsClosedWithoutAnApiKeyProperty = () => {
  const ctx = fresh();
  ctx.store.API_KEY = undefined;
  const res = ctx.get('users', 'test-key');
  assert.strictEqual(res.success, false);
  assert.match(res.message, /API_KEY/);
};

const refusesAWriteWithAWrongKey = () => {
  const res = fresh().post({ action: 'audit_log', key: 'not-the-key', record: { action: 'create' } });
  assert.strictEqual(res.success, false);
};

// ------------------------------------------------------------------- setup

const setupCreatesEverySheet = () => {
  const res = fresh({ setup: false }).setup();
  assert.strictEqual(res.success, true, res.message);
  // check-bridge.js prints `data`, so it has to stay an array of sheet names.
  assert.ok(Array.isArray(res.data), 'data must be the list of sheet names');
  ['Users', 'Students', 'Subjects', 'SubjectAllocations', 'AuditLog'].forEach((name) => {
    assert.ok(res.data.includes(name), `${name} is missing from the created sheets`);
  });
};

const setupGivesAllocationsFourteenColumns = () => {
  const ctx = fresh({ setup: false });
  ctx.setup();
  assert.strictEqual(ctx.sheets.SubjectAllocations.getLastColumn(), 14);
};

const setupIsIdempotent = () => {
  const ctx = fresh();
  const before = ctx.sheets.Students.cells[0].join('|');
  ctx.setup();
  assert.strictEqual(ctx.sheets.Students.cells[0].join('|'), before, 'a second run must not touch the header row');
};

// -------------------------------------------------------------- allocations

const hodCreatesAnAllocationInTheirDepartment = () => {
  const ctx = fresh();
  const res = ctx.seed();
  assert.strictEqual(res.success, true, res.message);
  assert.match(res.data.allocationId, /^ALC-/, 'allocationId must be prefixed');
  assert.strictEqual(res.data.status, 'active', 'a new allocation must be active');
  assert.ok(res.data.createdAt, 'createdAt must be stamped');
};

const theAllocationReadsBack = () => {
  const ctx = fresh();
  ctx.seed();
  const res = ctx.get('subject_allocations');
  assert.strictEqual(res.success, true, res.message);
  assert.strictEqual(res.data.length, 1);
  assert.strictEqual(res.data[0].subjectCode, 'CS301');
  assert.strictEqual(res.data[0].departmentId, 'CSE');
};

const updateGoesThroughTheOwningHod = () => {
  const ctx = fresh();
  const row = ctx.seed().data;
  const res = ctx.post({
    action: 'update_subject_allocation',
    key: 'test-key',
    actor: HOD,
    id: row.allocationId,
    record: { note: 'checked', status: 'inactive' },
  });
  assert.strictEqual(res.success, true, res.message);
  assert.strictEqual(res.data.note, 'checked');
  assert.strictEqual(res.data.status, 'inactive');
  assert.strictEqual(res.data.subjectCode, 'CS301', 'unrelated columns must survive the update');
};

const deleteRemovesTheAllocation = () => {
  const ctx = fresh();
  const row = ctx.seed().data;
  const res = ctx.post({ action: 'delete_subject_allocation', key: 'test-key', actor: ADMIN, id: row.allocationId });
  assert.strictEqual(res.success, true, res.message);
  assert.strictEqual(ctx.get('subject_allocations').data.length, 0);
};

// ------------------------------------------------------- department re-check

const rejectsAnHodWritingIntoAnotherDepartment = () => {
  const ctx = fresh();
  const res = ctx.post({
    action: 'create_subject_allocation',
    key: 'test-key',
    actor: OTHER_HOD,
    record: { departmentId: 'CSE', semester: 3, subjectCode: 'CS399', facultyId: 'FAC-9' },
  });
  assert.strictEqual(res.success, false, 'a cross-department write must be refused');
  assert.match(res.message, /does not match the row department/);
  assert.strictEqual(ctx.get('subject_allocations').data.length, 0, 'the refused row must not be written');
};

const rejectsAWriteWithNoActor = () => {
  const res = fresh().post({
    action: 'create_material',
    key: 'test-key',
    record: { departmentId: 'CSE', title: 'x', subjectCode: 'CS301' },
  });
  assert.strictEqual(res.success, false);
  assert.match(res.message, /actor is missing/);
};

/**
 * The interesting one: a patch need not restate departmentId, so the stored row
 * has to decide. Otherwise omitting the field would skip the check entirely.
 */
const updateFallsBackToTheStoredDepartment = () => {
  const ctx = fresh();
  const row = ctx.seed().data;
  const res = ctx.post({
    action: 'update_subject_allocation',
    key: 'test-key',
    actor: OTHER_HOD,
    id: row.allocationId,
    record: { note: 'hijack' },
  });
  assert.strictEqual(res.success, false, 'the stored department must still be enforced');
  assert.match(res.message, /does not match/);
};

const letsAnAdminWriteAnyDepartment = () => {
  const ctx = fresh();
  const res = ctx.post({
    action: 'create_subject_allocation',
    key: 'test-key',
    actor: ADMIN,
    record: { departmentId: 'ECE', semester: 5, subjectCode: 'EC501', facultyId: 'FAC-2', subjectName: 'Signals' },
  });
  assert.strictEqual(res.success, true, res.message);
  assert.strictEqual(ctx.get('subject_allocations').data.length, 1);
};

// ----------------------------------------------------------------- routing

/** create_department names a singular resource, but the sheet is Departments. */
const mapsSingularResourcesToTheirSheet = () => {
  const ctx = fresh();
  const res = ctx.post({
    action: 'create_department',
    key: 'test-key',
    actor: ADMIN,
    record: { departmentId: 'ECE', departmentCode: 'ECE', departmentName: 'Electronics' },
  });
  assert.strictEqual(res.success, true, res.message);
  assert.strictEqual(res.data.status, 'active');
  assert.ok(ctx.sheets.Departments, 'Departments must be the sheet that was written');
};

const rejectsAnUnknownAction = () => {
  const ctx = fresh();
  assert.match(ctx.get('no_such_table').message, /Unknown GET action/);
  assert.match(ctx.post({ action: 'create_widget', key: 'test-key' }).message, /Unknown POST action/);
};

/** Legacy deployments answered "ERP API is running"; the bridge must not. */
const healthResponseDoesNotImitateTheLegacyScript = () => {
  const res = fresh().get('');
  assert.strictEqual(res.success, true);
  assert.doesNotMatch(res.message, /erp api is running/i, 'this would make the backend pick the legacy dialect');
};

// --------------------------------------------------------------- other paths

const auditLogIsAppendOnly = () => {
  const ctx = fresh();
  const res = ctx.post({
    action: 'audit_log',
    key: 'test-key',
    record: { action: 'create', resource: 'SubjectAllocation', recordId: 'ALC-1', performedBy: 'USR-1' },
  });
  assert.strictEqual(res.success, true, res.message);
  assert.match(res.data.auditId, /^AUD-/);
  assert.strictEqual(ctx.get('audit_log').data.length, 1);
};

const attendanceUpsertsOnStudentSubjectAndDate = () => {
  const ctx = fresh();
  const row = { date: '2026-10-04', registerNumber: 'STU-001', subjectCode: 'CS301', semester: 3, departmentId: 'CSE' };
  const send = (status) =>
    ctx.post({ action: 'save_attendance', key: 'test-key', actor: HOD, records: [{ ...row, status }] });

  assert.strictEqual(send('present').success, true);
  assert.strictEqual(send('absent').success, true);

  const rows = ctx.get('attendance').data;
  assert.strictEqual(rows.length, 1, 'the second save must update in place, never append a duplicate');
  assert.strictEqual(rows[0].status, 'absent');
};

const notificationsDefaultToUnread = () => {
  const ctx = fresh();
  const res = ctx.post({
    action: 'create_notifications',
    key: 'test-key',
    records: [{ userId: 'USR-1', title: 'a', message: 'b' }, { userId: 'USR-2', title: 'c', message: 'd' }],
  });
  assert.strictEqual(res.success, true, res.message);
  const rows = ctx.get('notifications').data;
  assert.strictEqual(rows.length, 2);
  rows.forEach((n) => assert.strictEqual(n.isRead, 'FALSE', 'isRead must be the text FALSE, not a blank'));
};

/** create_user sends the bcrypt hash beside the record, not inside it. */
const createUserPicksUpTheSiblingPasswordHash = () => {
  const res = fresh().post({
    action: 'create_user',
    key: 'test-key',
    actor: ADMIN,
    record: { name: 'Asha', email: 'asha@college.edu', role: 'faculty', departmentId: 'CSE' },
    passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
  });
  assert.strictEqual(res.success, true, res.message);
  assert.strictEqual(res.data.passwordHash, '$2a$10$abcdefghijklmnopqrstuv');
};

const missingSheetExplainsHowToFixIt = () => {
  const res = fresh({ setup: false }).get('users');
  assert.strictEqual(res.success, false);
  assert.match(res.message, /does not exist.*setupSheets/s);
};

const tests = [
  ['a wrong API key is rejected', rejectsAWrongKey],
  ['a missing API key is rejected', rejectsAMissingKey],
  ['the bridge fails closed when API_KEY is unset', failsClosedWithoutAnApiKeyProperty],
  ['a write with a wrong API key is rejected', refusesAWriteWithAWrongKey],
  ['setupSheets creates every sheet', setupCreatesEverySheet],
  ['SubjectAllocations gets all 14 columns', setupGivesAllocationsFourteenColumns],
  ['setupSheets is idempotent', setupIsIdempotent],
  ['an HOD allocates a subject in their department', hodCreatesAnAllocationInTheirDepartment],
  ['the allocation reads back through subject_allocations', theAllocationReadsBack],
  ['update_subject_allocation reaches the owning HOD', updateGoesThroughTheOwningHod],
  ['delete_subject_allocation removes the row', deleteRemovesTheAllocation],
  ['an HOD cannot write into another department', rejectsAnHodWritingIntoAnotherDepartment],
  ['a write with no actor is rejected', rejectsAWriteWithNoActor],
  ['an update falls back to the stored department', updateFallsBackToTheStoredDepartment],
  ['an admin may write any department', letsAnAdminWriteAnyDepartment],
  ['a singular resource maps to its real sheet', mapsSingularResourcesToTheirSheet],
  ['an unknown action is refused, not guessed', rejectsAnUnknownAction],
  ['the health response does not imitate the legacy script', healthResponseDoesNotImitateTheLegacyScript],
  ['audit_log is append-only', auditLogIsAppendOnly],
  ['attendance upserts on student + subject + date', attendanceUpsertsOnStudentSubjectAndDate],
  ['notifications default to unread', notificationsDefaultToUnread],
  ['create_user picks up the sibling passwordHash', createUserPicksUpTheSiblingPasswordHash],
  ['a missing sheet explains how to create it', missingSheetExplainsHowToFixIt],
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

process.stdout.write(`\n${tests.length - failed}/${tests.length} bridge contract checks passed.\n`);
process.exit(failed ? 1 : 0);