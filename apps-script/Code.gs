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
  SPREADSHEET_ID: '1XN-TcJCPgFFpexcCdFuz9jmf-T4NZx1h2RZ5KxaTu-aSVkVbqs0sbFso',
  API_KEY: '',
};

/**
 * The deployment serves exactly one academic department. departmentId is the
 * permanent relationship key used across the frontend, backend, this bridge and
 * Google Sheets; it intentionally equals departmentCode so the two can never
 * drift apart in a record or a dropdown. Keep these four values in sync with
 * backend/src/config/department.js.
 */
var SINGLE_DEPARTMENT = {
  departmentId: 'CS01',
  departmentCode: 'CS01',
  departmentName: 'Computer Science and Engineering',
  status: 'active',
};

/** Every table whose rows carry departmentId/departmentName columns. */
var DEPARTMENT_OWNED_TABLES = [
  'Students', 'Users', 'Faculty', 'HODs', 'Subjects', 'Attendance',
  'SubjectAllocations', 'Materials', 'Assignments', 'AssignmentSubmissions',
  'Marks', 'Timetable', 'Exams', 'Announcements',
];

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
    'createdAt', 'link', 'entityType', 'entityId',
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
 *
 * The backend sends lowercase action names; the lookup is still lowered here so
 * "create_HOD", "create_hod" and "create_Hods" all resolve to the same sheet.
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


/**
 * Send in-app notifications only to active users in the same department.
 * The frontend must read the Notifications sheet for these to appear in the UI.
 */
function notifyDepartment_(departmentId, title, message, type, targetRoles, entity) {
  var dept = String(departmentId || '').trim();
  if (!dept) return [];
  var allowed = (targetRoles || ['student', 'faculty', 'hod'])
    .map(function (role) { return String(role).toLowerCase(); });
  var users = readSheet_('Users');
  var now = nowIso_();
  // Deep-link target for the notification, so the student portal can open the
  // actual content record instead of a dead-end text line.
  var link = (entity && entity.link) || '';
  var entityType = (entity && entity.entityType) || '';
  var entityId = (entity && entity.entityId) || '';
  var notifications = users.filter(function (user) {
    var role = String(user.role || '').toLowerCase();
    var status = String(user.status || 'active').toLowerCase();
    return String(user.departmentId || '').trim() === dept &&
      allowed.indexOf(role) >= 0 &&
      status !== 'inactive' && status !== 'disabled';
  }).map(function (user) {
    return {
      notificationId: newId_('Notifications'),
      userId: user.userId,
      title: title,
      message: message,
      type: type || 'update',
      isRead: 'FALSE',
      readAt: '',
      createdAt: now,
      link: link,
      entityType: entityType,
      entityId: entityId
    };
  });
  return notifications.length ? createRows_('Notifications', notifications) : [];
}

function notifyAttendanceStudents_(records) {
  var users = readSheet_('Users');
  var created = [];
  (records || []).forEach(function (record) {
    var studentId = String(record.studentId || '').trim();
    var regNo = String(record.registerNumber || '').trim();
    var user = users.filter(function (u) {
      return String(u.role || '').toLowerCase() === 'student' &&
        String(u.departmentId || '').trim() === String(record.departmentId || '').trim() &&
        ((studentId && String(u.studentId || '').trim() === studentId) ||
         (!studentId && regNo && String(u.registerNumber || '').trim() === regNo));
    })[0];
    if (user && user.userId) {
      created = created.concat(createRows_('Notifications', [{
        notificationId: newId_('Notifications'),
        userId: user.userId,
        title: 'Attendance updated',
        message: 'Attendance for ' + String(record.subjectName || record.subjectCode || 'your subject') +
          ' on ' + String(record.date || '') + ' is ' + String(record.status || 'updated') + '.',
        type: 'attendance',
        isRead: 'FALSE',
        readAt: '',
        createdAt: nowIso_(),
        link: '/student/attendance',
        entityType: 'attendance',
        entityId: String(record.attendanceId || record.studentId || record.registerNumber || '')
      }]));
    }
  });
  return created;
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

/**
 * Bootstrap the first administrator account.
 *
 * Run ONCE from the Apps Script editor (Run > Run function >
 * createInitialAdmin_) while signed in as the deploying account. It writes the
 * Users row directly, so it works before the bridge key is set and before any
 * admin exists who could authorise a normal create.
 *
 * Apps Script cannot run bcrypt, so - exactly as passwordHash.js expects - the
 * password is stored as an iterated HMAC-SHA256 digest
 * (`hmac-sha256$<iterations>$<salt>$<digest>`). The backend accepts that format
 * for the first sign-in and rewrites it as bcrypt the first time the password is
 * changed from the account's own profile page.
 *
 * Defaults to the project's first administrator when called with no arguments.
 * Refuses to run while an active administrator already exists, so it can never
 * silently reset the password of a live admin account.
 */
function createInitialAdmin_(email, name, password) {
  var adminEmail = String(email || 'admin9799@gmail.com').trim().toLowerCase();
  var adminName = String(name || 'Administrator').trim() || 'Administrator';
  var adminPassword = String(password || 'pass@9799');

  var existing = readSheet_('Users').filter(function (user) {
    return String(user.role || '').toLowerCase() === 'admin' &&
      String(user.status || 'active').toLowerCase() === 'active';
  });
  if (existing.length) {
    return 'An active administrator already exists (' + existing[0].email +
      '). createInitialAdmin_ only runs while none exists.';
  }

  var salt = Utilities.getUuid();
  var iterations = 20000;
  createRows_('Users', [{
    name: adminName,
    email: adminEmail,
    role: 'admin',
    departmentId: '',
    departmentName: '',
    passwordHash: bootstrapHash_(adminPassword, salt, iterations),
    status: 'active',
  }]);
  return 'Administrator created: ' + adminEmail;
}

/**
 * Iterated HMAC-SHA256 KDF, byte-for-byte compatible with verifyPassword() in
 * backend/src/services/passwordHash.js. bcrypt is unavailable on the Apps Script
 * runtime, so this is the only place a non-bcrypt hash is written, and only for
 * the very first administrator.
 */
function bootstrapHash_(plain, salt, iterations) {
  var digest = String(plain);
  for (var i = 0; i < iterations; i += 1) {
    digest = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(digest, salt, Utilities.Charset.US_ASCII)
    );
  }
  return 'hmac-sha256$' + iterations + '$' + salt + '$' + digest;
}

// ----------------------------------------------------------------- single department

/**
 * Collapse the spreadsheet to the one supported department (CS01).
 *
 * 1. Delivers exactly one Departments row, carrying the canonical id / code /
 *    name / status, and removes every other department row.
 * 2. Reassigns every department-scoped row (Students, Users except admins,
 *    Faculty, HODs, Subjects, Attendance, ... ) to departmentId CS01 and the
 *    canonical departmentName, so no record can belong to a department the UI can
 *    no longer represent.
 *
 * Idempotent and safe to re-run: rows that already carry CS01 are left
 * untouched, and running it when everything is already CS01 changes nothing.
 */
function ensureSingleDepartment_() {
  // Guarantee every declared table exists so the migration cannot hit a
  // "sheet does not exist" error halfway through. setupSheets() only appends
  // missing columns and never rewrites existing values.
  setupSheets();

  var report = {
    departmentId: SINGLE_DEPARTMENT.departmentId,
    departmentRowsRemoved: 0,
    rowsReassigned: 0,
    usersReassigned: 0,
    tablesSkipped: [],
  };

  report.departmentRowsRemoved = collapseDepartments_();

  DEPARTMENT_OWNED_TABLES.forEach(function (table) {
    var changed = reassignDepartment_(table);
    if (changed === null) {
      report.tablesSkipped.push(table);
    } else if (table === 'Users') {
      report.usersReassigned += changed;
    } else {
      report.rowsReassigned += changed;
    }
  });

  return report;
}

/**
 * Rewrite the Departments sheet so it holds exactly one row with the canonical
 * values. Returns the number of other department rows that were removed.
 */
function collapseDepartments_() {
  var sheet = getSheet_('Departments');
  var cols = headers_(sheet);
  var lastRow = sheet.getLastRow();
  var kept = null;
  var keptIndex = -1;

  if (lastRow >= 2 && cols.length) {
    var idIdx = cols.indexOf('departmentId');
    var codeIdx = cols.indexOf('departmentCode');
    var values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
    for (var r = 0; r < values.length; r += 1) {
      var id = String(idIdx >= 0 ? values[r][idIdx] : '').trim().toUpperCase();
      var code = String(codeIdx >= 0 ? values[r][codeIdx] : '').trim().toUpperCase();
      if (id === SINGLE_DEPARTMENT.departmentId || code === SINGLE_DEPARTMENT.departmentCode) {
        kept = values[r];
        keptIndex = r;
        break;
      }
    }
    // Delete every other row bottom-up so row indices stay valid.
    var removed = 0;
    for (var r2 = lastRow - 1; r2 >= 0; r2 -= 1) {
      if (r2 === keptIndex) continue;
      sheet.deleteRow(r2 + 2);
      removed += 1;
    }
  }

  var patch = {
    departmentId: SINGLE_DEPARTMENT.departmentId,
    departmentCode: SINGLE_DEPARTMENT.departmentCode,
    departmentName: SINGLE_DEPARTMENT.departmentName,
    status: SINGLE_DEPARTMENT.status,
  };
  if (kept && cols.indexOf('createdAt') >= 0 && kept[cols.indexOf('createdAt')]) {
    patch.createdAt = kept[cols.indexOf('createdAt')];
  }

  var rows = readSheet_('Departments');
  if (rows.length) {
    // The remaining row (if any) gets its id/code/name normalised in place.
    updateRow_('Departments', String(rows[0].departmentId || ''), patch);
  } else {
    createRows_('Departments', [patch]);
  }

  return lastRow >= 2 && cols.length ? lastRow - 1 - (kept ? 1 : 0) : 0;
}

/**
 * Reassign every row of `table` to departmentId CS01 / the canonical name.
 * Admin rows on Users keep an empty department. Returns the number of rows whose
 * departmentId actually changed, or null when the table is not present.
 */
function reassignDepartment_(table) {
  var sheet;
  try {
    sheet = getSheet_(table);
  } catch (error) {
    return null;
  }

  var cols = headers_(sheet);
  if (!cols.length) return 0;
  var idIdx = cols.indexOf('departmentId');
  var nameIdx = cols.indexOf('departmentName');
  if (idIdx < 0 && nameIdx < 0) return 0;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var roleIdx = cols.indexOf('role');
  var values = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  var idCol = [];
  var nameCol = [];
  var changed = 0;

  for (var r = 0; r < values.length; r += 1) {
    if (table === 'Users' && roleIdx >= 0 && String(values[r][roleIdx] || '').toLowerCase() === 'admin') {
      if (idIdx >= 0) idCol.push('');
      if (nameIdx >= 0) nameCol.push('');
      continue;
    }
    if (String(idIdx >= 0 ? values[r][idIdx] || '' : '').trim() !== SINGLE_DEPARTMENT.departmentId) {
      changed += 1;
    }
    if (idIdx >= 0) idCol.push(SINGLE_DEPARTMENT.departmentId);
    if (nameIdx >= 0) nameCol.push(SINGLE_DEPARTMENT.departmentName);
  }

  if (idIdx >= 0) {
    sheet.getRange(2, idIdx + 1, values.length, 1).setValues(idCol.map(function (v) { return [v]; }));
  }
  if (nameIdx >= 0) {
    sheet.getRange(2, nameIdx + 1, values.length, 1).setValues(nameCol.map(function (v) { return [v]; }));
  }
  return changed;
}

/**
 * Run from the Apps Script editor (Run > Run function > setupSingleDepartment)
 * or, once the API_KEY Script Property is set, via the backend
 * (POST /api/departments/migrate as an admin). Idempotent.
 */
function setupSingleDepartment() {
  return JSON.stringify(ensureSingleDepartment_());
}

// ----------------------------------------------------------------- routing

function tableForAction_(action) {
  var name = String(action || '');
  var match = /^(?:create|update|delete)_(.+)$/.exec(name);
  var resource = match ? match[1] : name;
  return TABLE_BY_RESOURCE[resource.toLowerCase()] || null;
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

    if (action === 'migrate_single_department') {
      // Deployment-level migration, not a row write: no actor is required.
      return ok_('Single-department migration complete.', ensureSingleDepartment_());
    }

    if (action === 'save_attendance') {
      // One row per student per subject per day.
      var saved = (body.records || []).map(function (record) {
        assertDepartment_('Attendance', record, null, actor);
        return upsertBy_('Attendance', ['registerNumber', 'subjectCode', 'date'], record);
      });
      notifyAttendanceStudents_(saved);
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

      // Notify active users in this department after a successful write.
      // Notifications are per-user and never cross department boundaries.
      if (table === 'Materials') {
        created.forEach(function (item) {
          notifyDepartment_(item.departmentId, 'New study material',
            String(item.title || item.fileName || 'A new material') + ' is available for ' +
              String(item.subjectName || item.subjectCode || 'your subject') + '.',
            'material', ['student', 'faculty', 'hod'],
            { link: '/student/materials', entityType: 'material', entityId: item.materialId });
        });
      } else if (table === 'Assignments') {
        created.forEach(function (item) {
          notifyDepartment_(item.departmentId, 'New assignment',
            String(item.title || 'An assignment') + ' has been posted for ' +
              String(item.subjectName || item.subjectCode || 'your subject') + '.',
            'assignment', ['student', 'faculty', 'hod'],
            { link: '/student/assignments', entityType: 'assignment', entityId: item.assignmentId });
        });
      } else if (table === 'Announcements') {
        created.forEach(function (item) {
          notifyDepartment_(item.departmentId, item.title || 'Department announcement',
            item.description || 'A new department announcement is available.',
            'announcement', ['student', 'faculty', 'hod'],
            { link: '/student/announcements', entityType: 'announcement', entityId: item.announcementId });
        });
      }

      return ok_(table + ' created.', created.length === 1 ? created[0] : created);
    }

    if (/^update_/.test(action)) {
      if (!table) throw new Error('Unknown POST action: ' + action);
      var id = body.id;
      assertDepartment_(table, body.record || {}, id, actor);
      var updated = updateRow_(table, id, body.record || {});
      if (!updated) throw new Error('No ' + table + ' row with id ' + id + '.');

      // Notify the same department when a material/assignment/announcement changes.
      if (table === 'Materials') {
        notifyDepartment_(updated.departmentId, 'Study material updated',
          String(updated.title || updated.fileName || 'A study material') + ' has been updated.',
          'material', ['student', 'faculty', 'hod'],
          { link: '/student/materials', entityType: 'material', entityId: updated.materialId });
      } else if (table === 'Assignments') {
        notifyDepartment_(updated.departmentId, 'Assignment updated',
          String(updated.title || 'An assignment') + ' has been updated.',
          'assignment', ['student', 'faculty', 'hod'],
          { link: '/student/assignments', entityType: 'assignment', entityId: updated.assignmentId });
      } else if (table === 'Announcements') {
        notifyDepartment_(updated.departmentId, updated.title || 'Announcement updated',
          updated.description || 'A department announcement has been updated.',
          'announcement', ['student', 'faculty', 'hod'],
          { link: '/student/announcements', entityType: 'announcement', entityId: updated.announcementId });
      }
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
