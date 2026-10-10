/**
 * Hindusthan Department ERP - Google Apps Script bridge.
 *
 * The Node backend is the only writer. This script is the transport: it turns
 * snake_case actions into reads and writes on one spreadsheet, and re-checks
 * department authority on every department-scoped write so a backend bug still
 * cannot put one department's data into another's rows.
 *
 * Deploy: Deploy > New deployment > Web app > Execute as Me >
 *         Who has access: Anyone.
 * Then run setupSheets() ONCE from the editor, and set the API_KEY Script
 * Property to the same value as APPS_SCRIPT_API_KEY in backend/.env.
 *
 * Everything here resolves columns by header NAME, never by position in SCHEMA,
 * so a column that was dragged or appended still reads and writes the right
 * cells. setupSheets() only ever appends; it never renames, reorders or
 * rewrites a header that already exists.
 */

// ---------------------------------------------------------------- settings

var SETTINGS = {
  SPREADSHEET_ID: '',
  API_KEY: '',
};

// ------------------------------------------------------------------ schema

var SCHEMA = {
  Students: [
    'studentId', 'registerNumber', 'name', 'email', 'phone', 'semester',
    'departmentId', 'departmentName', 'batch', 'status', 'createdAt', 'updatedAt',
  ],
  Users: [
    'userId', 'name', 'email', 'role', 'departmentId', 'departmentName',
    'passwordHash', 'status', 'studentId', 'facultyId', 'hodId', 'createdAt',
    'updatedAt', 'lastLoginAt',
  ],
  Departments: ['departmentId', 'departmentCode', 'departmentName', 'status', 'createdAt', 'updatedAt'],
  Faculty: [
    'facultyId', 'employeeId', 'name', 'email', 'phone', 'designation',
    'departmentId', 'departmentName', 'status', 'createdAt', 'updatedAt',
  ],
  HODs: [
    'hodId', 'employeeId', 'name', 'email', 'phone', 'designation',
    'departmentId', 'departmentName', 'status', 'createdAt', 'updatedAt',
  ],
  Subjects: [
    'subjectId', 'subjectCode', 'subjectName', 'semester', 'credits',
    'departmentId', 'departmentName', 'status', 'createdAt', 'updatedAt',
  ],
  Attendance: [
    'attendanceId', 'date', 'registerNumber', 'studentName', 'studentId',
    'subjectCode', 'subjectName', 'semester', 'departmentId', 'departmentName',
    'status', 'facultyId', 'facultyName', 'createdAt', 'updatedAt',
    'updatedBy', 'updatedByRole',
  ],
  SubjectAllocations: [
    'allocationId', 'departmentId', 'departmentName', 'semester', 'subjectCode',
    'subjectName', 'facultyId', 'facultyName', 'assignedDate', 'assignedBy',
    'note', 'status', 'createdAt', 'updatedAt',
  ],
  Materials: [
    'materialId', 'title', 'description', 'subjectCode', 'subjectName', 'semester',
    'fileUrl', 'fileId', 'fileName', 'uploadedBy', 'uploadedById', 'departmentId',
    'departmentName', 'createdAt', 'updatedAt', 'facultyId', 'facultyName',
    'visibility', 'status', 'uploadDate', 'uploadedDate',
  ],
  Assignments: [
    'assignmentId', 'title', 'description', 'subjectCode', 'subjectName',
    'semester', 'assignedDate', 'dueDate', 'assignedBy', 'assignedById',
    'status', 'departmentId', 'departmentName', 'createdAt', 'updatedAt',
  ],
  AssignmentSubmissions: [
    'submissionId', 'assignmentId', 'studentId', 'registerNumber', 'studentName',
    'submittedAt', 'submissionNote', 'fileUrl', 'status', 'departmentId',
    'createdAt', 'updatedAt',
  ],
  Marks: [
    'marksId', 'registerNumber', 'studentName', 'studentId', 'subjectCode',
    'subjectName', 'semester', 'internalMark', 'assignmentMark', 'examMark',
    'semesterResult', 'departmentId', 'departmentName', 'createdAt', 'updatedAt',
    'updatedBy', 'updatedByRole',
  ],
  Timetable: [
    'timetableId', 'day', 'startTime', 'endTime', 'subjectCode', 'subjectName',
    'semester', 'room', 'facultyName', 'departmentId', 'departmentName',
    'createdAt', 'updatedAt',
  ],
  Exams: [
    'examId', 'examName', 'examType', 'subjectCode', 'subjectName', 'semester',
    'date', 'startTime', 'endTime', 'room', 'departmentId', 'departmentName',
    'createdAt', 'updatedAt',
  ],
  Announcements: [
    'announcementId', 'title', 'description', 'category', 'priority',
    'publishDate', 'targetRole', 'departmentId', 'departmentName', 'createdBy',
    'createdByName', 'createdAt', 'updatedAt', 'updatedBy',
  ],
  Notifications: [
    'notificationId', 'userId', 'title', 'message', 'type', 'isRead', 'readAt',
    'createdAt',
  ],
  AuditLog: [
    'auditId', 'action', 'resource', 'recordId', 'performedBy',
    'performedByName', 'performedByRole', 'departmentId', 'detail', 'createdAt',
  ],
};

var PK = {
  Students: 'studentId',
  Users: 'userId',
  Departments: 'departmentId',
  Faculty: 'facultyId',
  HODs: 'hodId',
  Subjects: 'subjectId',
  Attendance: 'attendanceId',
  SubjectAllocations: 'allocationId',
  Materials: 'materialId',
  Assignments: 'assignmentId',
  AssignmentSubmissions: 'submissionId',
  Marks: 'marksId',
  Timetable: 'timetableId',
  Exams: 'examId',
  Announcements: 'announcementId',
  Notifications: 'notificationId',
  AuditLog: 'auditId',
};

var ID_PREFIX = {
  Students: 'STU',
  Users: 'USR',
  Departments: 'DEP',
  Faculty: 'FAC',
  HODs: 'HOD',
  Subjects: 'SUB',
  Attendance: 'ATT',
  SubjectAllocations: 'ALC',
  Materials: 'MAT',
  Assignments: 'ASG',
  AssignmentSubmissions: 'SUBM',
  Marks: 'MRK',
  Timetable: 'TTB',
  Exams: 'EXM',
  Announcements: 'ANN',
  Notifications: 'NTF',
  AuditLog: 'AUD',
};

/**
 * Every action name the backend sends -> the sheet that holds it.
 *
 * Both the singular and plural spelling are listed because the backend derives
 * write actions from a singular resource ("create_department") while reads use
 * the dataService table name ("departments"). Capitalising the token instead
 * would yield `Department`, which is not a sheet, so the mapping is explicit.
 */
var TABLE_BY_RESOURCE = {
  user: 'Users',
  users: 'Users',
  student: 'Students',
  students: 'Students',
  faculty: 'Faculty',
  hods: 'HODs',
  hod: 'HODs',
  department: 'Departments',
  departments: 'Departments',
  subject: 'Subjects',
  subjects: 'Subjects',
  subject_allocation: 'SubjectAllocations',
  subject_allocations: 'SubjectAllocations',
  attendance: 'Attendance',
  material: 'Materials',
  materials: 'Materials',
  assignment: 'Assignments',
  assignments: 'Assignments',
  assignment_submission: 'AssignmentSubmissions',
  assignment_submissions: 'AssignmentSubmissions',
  mark: 'Marks',
  marks: 'Marks',
  timetable: 'Timetable',
  exam: 'Exams',
  exams: 'Exams',
  announcement: 'Announcements',
  announcements: 'Announcements',
  notification: 'Notifications',
  notifications: 'Notifications',
  audit_log: 'AuditLog',
};

/** Tables whose writes carry a departmentId that must match the actor's. */
var DEPARTMENT_FIELD = {
  Students: 'departmentId',
  Users: 'departmentId',
  Faculty: 'departmentId',
  HODs: 'departmentId',
  Subjects: 'departmentId',
  Attendance: 'departmentId',
  SubjectAllocations: 'departmentId',
  Materials: 'departmentId',
  Assignments: 'departmentId',
  AssignmentSubmissions: 'departmentId',
  Marks: 'departmentId',
  Timetable: 'departmentId',
  Exams: 'departmentId',
  Announcements: 'departmentId',
};

// ----------------------------------------------------------------- plumbing

function props_() {
  return PropertiesService.getScriptProperties();
}

function setting_(name) {
  var stored = props_().getProperty(name);
  return String(stored || SETTINGS[name] || '').trim();
}

function getSpreadsheet_() {
  var id = setting_('SPREADSHEET_ID');
  if (!id) {
    throw new Error(
      'Spreadsheet entity is required. Set the SPREADSHEET_ID Script Property, ' +
        'or fill in SETTINGS.SPREADSHEET_ID in Code.gs.'
    );
  }
  return SpreadsheetApp.openById(id);
}

function getSheet_(table) {
  var sheet = getSpreadsheet_().getSheetByName(table);
  if (!sheet) {
    throw new Error(
      'Sheet "' + table + '" does not exist. Run setupSheets() once from the ' +
        'Apps Script editor, then redeploy.'
    );
  }
  return sheet;
}

/** Header names in sheet order, trimmed. Empty when the sheet is untouched. */
function headers_(sheet) {
  if (sheet.getLastRow() === 0) return [];
  var width = sheet.getLastColumn();
  if (!width) return [];
  return sheet
    .getRange(1, 1, 1, width)
    .getValues()[0]
    .map(function (cell) {
      return String(cell === null || cell === undefined ? '' : cell).trim();
    });
}

/** Sheets coerce anything date-looking into a Date; the API contract is ISO. */
function normalizeCell_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function nowIso_() {
  return new Date().toISOString();
}

function newId_(table) {
  var prefix = ID_PREFIX[table] || 'ROW';
  return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase();
}

function cellValue_(value) {
  return value === undefined || value === null ? '' : normalizeCell_(value);
}

/**
 * Fail closed: no API_KEY Script Property means nothing is served, because an
 * open bridge would let anyone read every user's row and rewrite the sheets.
 */
function assertAuthorized_(key) {
  var expected = setting_('API_KEY');
  if (!expected) {
    throw new Error(
      'Unauthorized request. The API_KEY Script Property is not set on this ' +
        'deployment, so every call is refused. Set it to the same value as ' +
        'APPS_SCRIPT_API_KEY in backend/.env.'
    );
  }
  var given = String(key || '').trim();
  if (!given || given !== expected) {
    throw new Error('Unauthorized request');
  }
}

// --------------------------------------------------------------- read/write

/**
 * Every declared column is present on the row, even when the sheet predates it
 * and has no such column - those read as '' rather than undefined, so the
 * backend never has to guard for a missing key.
 */
function readSheet_(table) {
  var sheet = getSheet_(table);
  var cols = headers_(sheet);
  if (!cols.length) return [];

  var declared = SCHEMA[table] || cols;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r += 1) {
    var row = {};
    for (var c = 0; c < cols.length; c += 1) {
      if (!cols[c]) continue;
      row[cols[c]] = normalizeCell_(values[r][c]);
    }
    for (var d = 0; d < declared.length; d += 1) {
      if (!(declared[d] in row)) row[declared[d]] = '';
    }
    rows.push(row);
  }
  return rows;
}

function findRowNumber_(sheet, table, id) {
  var cols = headers_(sheet);
  var pk = PK[table];
  var pkIndex = cols.indexOf(pk);
  if (pkIndex < 0) {
    throw new Error('Sheet "' + table + '" has no "' + pk + '" column. Run setupSheets().');
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, pkIndex + 1, lastRow - 1, 1).getValues();
  var target = String(id === null || id === undefined ? '' : id).trim();
  for (var i = 0; i < ids.length; i += 1) {
    if (String(ids[i][0] === null || ids[i][0] === undefined ? '' : ids[i][0]).trim() === target) {
      return i + 2;
    }
  }
  return -1;
}

/** Patch only the columns the sheet actually has; everything else is left alone. */
function updateRow_(table, id, patch) {
  var sheet = getSheet_(table);
  var rowNumber = findRowNumber_(sheet, table, id);
  if (rowNumber < 0) return null;

  var cols = headers_(sheet);
  var fields = patch || {};
  var applied = {};

  Object.keys(fields).forEach(function (key) {
    var index = cols.indexOf(key);
    if (index < 0) return;
    var value = cellValue_(fields[key]);
    sheet.getRange(rowNumber, index + 1, 1, 1).setValue(value);
    applied[key] = value;
  });

  if (cols.indexOf('updatedAt') >= 0 && !('updatedAt' in fields)) {
    sheet.getRange(rowNumber, cols.indexOf('updatedAt') + 1, 1, 1).setValue(nowIso_());
  }

  return readSheet_(table)[rowNumber - 2] || applied;
}

function appendRows_(table, records) {
  var list = (records || []).filter(function (r) {
    return r && typeof r === 'object';
  });
  if (!list.length) return [];

  var sheet = getSheet_(table);
  var cols = headers_(sheet);
  if (!cols.length) {
    cols = SCHEMA[table] || [];
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  }

  var width = cols.length;
  var matrix = list.map(function (record) {
    var line = new Array(width);
    for (var i = 0; i < width; i += 1) line[i] = cellValue_(record[cols[i]]);
    return line;
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, list.length, width).setValues(matrix);
  return list;
}

/** Defaults applied on create so a row is never born with a blank status. */
function stampDefaults_(table, record, cols) {
  var out = {};
  Object.keys(record || {}).forEach(function (key) {
    out[key] = cellValue_(record[key]);
  });

  if (cols.indexOf(PK[table]) >= 0 && !out[PK[table]]) out[PK[table]] = newId_(table);
  if (cols.indexOf('createdAt') >= 0 && !out.createdAt) out.createdAt = nowIso_();
  if (cols.indexOf('updatedAt') >= 0 && !out.updatedAt) out.updatedAt = out.createdAt || nowIso_();
  if (cols.indexOf('status') >= 0 && !out.status) out.status = 'active';
  if (cols.indexOf('isRead') >= 0 && !out.isRead) out.isRead = 'FALSE';

  return out;
}

function createRows_(table, records) {
  var list = (records || []).filter(function (r) {
    return r && typeof r === 'object';
  });
  if (!list.length) return [];

  var sheet = getSheet_(table);
  var cols = headers_(sheet);
  if (!cols.length) {
    cols = SCHEMA[table] || [];
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
  }

  return appendRows_(table, list.map(function (record) {
    return stampDefaults_(table, record, cols);
  }));
}

/**
 * Update the first row matching every key column, or append when none matches.
 * The patch never has to carry the primary key: it comes from the matched row,
 * so an upsert cannot blank the id or duplicate the row.
 */
function upsertBy_(table, keys, patch) {
  var sheet = getSheet_(table);
  var cols = headers_(sheet);
  var keyCols = (keys || []).filter(function (k) {
    return cols.indexOf(k) >= 0;
  });

  if (cols.length && keyCols.length) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
      for (var r = 0; r < values.length; r += 1) {
        var matched = keyCols.every(function (key) {
          var index = cols.indexOf(key);
          return String(values[r][index] === null || values[r][index] === undefined ? '' : values[r][index]).trim() ===
            String(patch[key] === null || patch[key] === undefined ? '' : patch[key]).trim();
        });
        if (matched) {
          var pkIndex = cols.indexOf(PK[table]);
          return updateRow_(table, values[r][pkIndex], patch);
        }
      }
    }
  }

  return createRows_(table, [patch])[0];
}

function deleteRow_(table, id) {
  var sheet = getSheet_(table);
  var rowNumber = findRowNumber_(sheet, table, id);
  if (rowNumber < 0) return null;
  var existing = readSheet_(table)[rowNumber - 2] || null;
  sheet.deleteRow(rowNumber);
  return existing;
}

// -------------------------------------------------------------- permissions

/**
 * The backend already scopes every write by the authenticated session, but it
 * is not the only thing standing between a bug and cross-department data. This
 * is the second gate: an admin may write any department, anyone else may only
 * write their own, and a write with no actor at all is refused.
 */
function assertDepartment_(table, record, id, actor) {
  var field = DEPARTMENT_FIELD[table];
  if (!field) return;

  if (!actor || !actor.userId) {
    throw new Error(
      'Unauthorized write to ' + table + '. The actor is missing, so the ' +
        'department cannot be verified.'
    );
  }

  var role = String(actor.role || '').toLowerCase();
  if (role === 'admin') return;

  var actorDepartment = String(actor.departmentId || '').trim();

  // A patch may not restate the department, so fall back to the stored row.
  var rowDepartment = String(record && record[field] ? record[field] : '').trim();
  if (!rowDepartment && id !== undefined && id !== null && id !== '') {
    var existing = readSheet_(table).filter(function (row) {
      return String(row[PK[table]] === null || row[PK[table]] === undefined ? '' : row[PK[table]]).trim() ===
        String(id).trim();
    })[0];
    if (existing) rowDepartment = String(existing[field] || '').trim();
  }

  if (!rowDepartment) return;
  if (!actorDepartment) {
    throw new Error(
      'Unauthorized write to ' + table + '. Your account has no department, so it ' +
        'cannot write a row that belongs to ' + rowDepartment + '.'
    );
  }
  if (actorDepartment !== rowDepartment) {
    throw new Error(
      'Unauthorized write to ' + table + '. Your department (' + actorDepartment +
        ') does not match the row department (' + rowDepartment + ').'
    );
  }
}

// ------------------------------------------------------------------- setup

/**
 * Create any missing sheet and append any missing column. Safe to run
 * repeatedly: it never renames, reorders or rewrites a header that already
 * exists, so data under those headers keeps its meaning.
 *
 * Run it once per deployment that changes SCHEMA.
 */
function setupSheets() {
  var ss = getSpreadsheet_();
  var created = [];
  var appended = [];
  var outOfOrder = [];

  Object.keys(SCHEMA).forEach(function (table) {
    var declared = SCHEMA[table];
    var sheet = ss.getSheetByName(table);

    if (!sheet) {
      sheet = ss.insertSheet(table);
      sheet.getRange(1, 1, 1, declared.length).setValues([declared]);
      try {
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, declared.length).setFontWeight('bold');
      } catch (error) {
        // Formatting is cosmetic; never let it abort the migration.
      }
      created.push(table);
      return;
    }

    var cols = headers_(sheet);
    if (!cols.length) {
      sheet.getRange(1, 1, 1, declared.length).setValues([declared]);
      created.push(table + ' (header row)');
      return;
    }

    var missing = declared.filter(function (name) {
      return cols.indexOf(name) < 0;
    });
    if (missing.length) {
      // Appended to the RIGHT of the current last column so existing values
      // never end up under a different label.
      sheet.getRange(1, cols.length + 1, 1, missing.length).setValues([missing]);
      appended.push(table + ': ' + missing.join(', '));
    }

    var present = declared.filter(function (name) {
      return cols.indexOf(name) >= 0;
    });
    var sheetOrder = cols.filter(function (name) {
      return present.indexOf(name) >= 0;
    });
    if (present.join('|') !== sheetOrder.join('|')) outOfOrder.push(table);
  });

  return { created: created, appended: appended, outOfOrder: outOfOrder };
}

function listSheets_() {
  var ss = getSpreadsheet_();
  var names = Object.keys(SCHEMA);
  return names.filter(function (table) {
    return !!ss.getSheetByName(table);
  });
}

// ----------------------------------------------------------------- routing

function tableForAction_(action) {
  var name = String(action || '');
  var match = /^(?:create|update|delete)_(.+)$/.exec(name);
  var resource = match ? match[1] : name;
  return TABLE_BY_RESOURCE[resource] || null;
}

function json_(payload) {
  return ContentService.createTextOutput()
    .setMimeType(ContentService.MimeType.JSON)
    .setContent(JSON.stringify(payload));
}

/** Every entry point answers 200 with a success flag, so the backend can read
 *  a real reason out of the body instead of guessing from an HTTP status. */
function ok_(message, data) {
  return json_({ success: true, message: message, data: data === undefined ? null : data });
}

function fail_(error) {
  var message = String((error && error.message) || error || 'Unknown error');
  return json_({ success: false, message: message, error: message });
}

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = String(params.action || '').trim();

    if (action === 'setup_sheets' || action === 'setupSheets') {
      assertAuthorized_(params.key);
      var report = setupSheets();
      // `data` must stay an array of sheet names: check-bridge.js prints it.
      return json_({
        success: true,
        message: 'Sheets are ready. Created: ' + (report.created.length || 'nothing') +
          '. Appended: ' + (report.appended.length || 'nothing') + '.',
        data: listSheets_(),
        created: report.created,
        appended: report.appended,
        outOfOrder: report.outOfOrder,
      });
    }

    assertAuthorized_(params.key);

    if (!action) {
      return ok_('ERP bridge ready. Pass ?action=<table>.');
    }

    var table = tableForAction_(action);
    if (!table) throw new Error('Unknown GET action: ' + action);
    return ok_(table + ' read.', readSheet_(table));
  } catch (error) {
    return fail_(error);
  }
}

function doPost(e) {
  try {
    var body = {};
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (error) {
      throw new Error('Request body was not valid JSON.');
    }

    var action = String(body.action || '').trim();
    assertAuthorized_(body.key);
    if (!action) throw new Error('No action was supplied.');

    var actor = body.actor || null;
    var table = tableForAction_(action);

    if (action === 'audit_log') {
      // Append-only: an audit row is never updated or deleted.
      return ok_('Audit entry recorded.', createRows_('AuditLog', [body.record || {}])[0]);
    }

    if (action === 'create_notifications') {
      return ok_('Notifications created.', createRows_('Notifications', body.records || []));
    }

    if (action === 'save_attendance') {
      // One row per student per subject per day.
      var saved = (body.records || []).map(function (record) {
        assertDepartment_('Attendance', record, null, actor);
        return upsertBy_('Attendance', ['registerNumber', 'subjectCode', 'date'], record);
      });
      return ok_('Attendance saved for ' + saved.length + ' row(s).', saved);
    }

    if (action === 'save_assignment_submission') {
      return ok_('Submission saved.', upsertBy_('AssignmentSubmissions', ['assignmentId', 'studentId'], body.record || {}));
    }

    if (/^create_/.test(action)) {
      if (!table) throw new Error('Unknown POST action: ' + action);
      var records = Array.isArray(body.records) ? body.records : [body.record || {}];
      records.forEach(function (record) {
        assertDepartment_(table, record, null, actor);
      });
      // create_user carries the bcrypt hash beside the record, not inside it.
      if (body.passwordHash) {
        records = records.map(function (record) {
          var copy = {};
          Object.keys(record).forEach(function (key) {
            copy[key] = record[key];
          });
          copy.passwordHash = body.passwordHash;
          return copy;
        });
      }
      var created = createRows_(table, records);
      return ok_(table + ' created.', created.length === 1 ? created[0] : created);
    }

    if (/^update_/.test(action)) {
      if (!table) throw new Error('Unknown POST action: ' + action);
      var id = body.id;
      assertDepartment_(table, body.record || {}, id, actor);
      var updated = updateRow_(table, id, body.record || {});
      if (!updated) throw new Error('No ' + table + ' row with id ' + id + '.');
      return ok_(table + ' updated.', updated);
    }

    if (/^delete_/.test(action)) {
      if (!table) throw new Error('Unknown POST action: ' + action);
      assertDepartment_(table, {}, body.id, actor);
      var removed = deleteRow_(table, body.id);
      if (!removed) throw new Error('No ' + table + ' row with id ' + body.id + '.');
      return ok_(table + ' deleted.', removed);
    }

    throw new Error('Unknown POST action: ' + action);
  } catch (error) {
    return fail_(error);
  }
}

/** Run once after deploying a new Code.gs: Deploy > New deployment, then this. */
function runSetup() {
  var report = setupSheets();
  return JSON.stringify(report);
}