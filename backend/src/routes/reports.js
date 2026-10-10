const router = require('express').Router();
const dataService = require('../services/dataService');
const appsScript = require('../services/appsScriptClient');
const { requireRole, actorOf } = require('../middleware/auth');
const { asyncHandler, badRequest, forbidden } = require('../middleware/error');
const { bySemesterThenCode } = require('../utils/subjectOrder');
const { byRegisterNumber } = require('../utils/naturalSort');
const { resolveFacultyRow, allocationsFor } = require('../utils/facultyScope');

/**
 * Department reports.
 *
 * Filtering and department scoping happen here on the server, so an HOD can only
 * ever download their own department's rows, and a faculty member can only
 * download rows for subjects allocated to them. The export is CSV with a UTF-8
 * BOM so it opens correctly in Excel.
 */

/** Reports the UI may offer, with the columns shown for each. */
const REPORTS = {
  students: { label: 'Students', columns: ['registerNumber', 'name', 'email', 'phone', 'semester', 'batch', 'status'], sort: byRegisterNumber },
  faculty: { label: 'Faculty', columns: ['employeeId', 'name', 'email', 'phone', 'designation', 'status'], sort: (a, b) => String(a.employeeId || '').localeCompare(String(b.employeeId || '')) },
  hods: { label: 'Heads of Department', columns: ['employeeId', 'name', 'email', 'phone', 'designation', 'status'], sort: (a, b) => String(a.employeeId || '').localeCompare(String(b.employeeId || '')) },
  subjects: { label: 'Subjects', columns: ['subjectCode', 'subjectName', 'semester', 'credits', 'status'], sort: bySemesterThenCode },
  subject_allocations: { label: 'Subject Allocation', columns: ['semester', 'subjectCode', 'subjectName', 'facultyName', 'assignedDate', 'status'], sort: bySemesterThenCode },
  materials: { label: 'Study Materials', columns: ['title', 'subjectCode', 'subjectName', 'semester', 'facultyName', 'fileUrl', 'uploadedDate'], sort: bySemesterThenCode },
  assignments: { label: 'Assignments', columns: ['title', 'subjectCode', 'subjectName', 'semester', 'assignedDate', 'dueDate'], sort: bySemesterThenCode },
  attendance: { label: 'Attendance', columns: ['date', 'registerNumber', 'studentName', 'subjectCode', 'subjectName', 'semester', 'status', 'facultyName'], sort: (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || byRegisterNumber(a, b) },
  marks: { label: 'Marks', columns: ['registerNumber', 'studentName', 'subjectCode', 'semester', 'internalMark', 'examMark', 'assignmentMark'], sort: byRegisterNumber },
  timetable: { label: 'Timetable', columns: ['day', 'startTime', 'endTime', 'subjectCode', 'subjectName', 'semester', 'room'], sort: (a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) },
  exams: { label: 'Exams', columns: ['examName', 'examType', 'subjectCode', 'semester', 'date', 'startTime', 'endTime', 'room'], sort: (a, b) => String(a.date || '').localeCompare(String(b.date || '')) },
};

const DATE_BEARING = new Set(['attendance', 'assignments', 'exams']);

/** Cell escaping + a BOM, so the download is valid for Excel and Google Sheets. */
const toCsv = (columns, rows) => {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.join(',')];
  rows.forEach((row) => lines.push(columns.map((column) => escape(row[column])).join(',')));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
};

const dataFor = {
  students: () => dataService.students(),
  faculty: () => dataService.faculty(),
  hods: () => dataService.hods().catch(() => []),
  subjects: () => dataService.subjects(),
  subject_allocations: () => dataService.subjectAllocations(),
  materials: () => dataService.materials(),
  assignments: () => dataService.assignments(),
  attendance: () => dataService.attendance(),
  marks: () => dataService.marks(),
  timetable: () => dataService.timetable(),
  exams: () => dataService.exams().catch(() => []),
};

/** A human-friendly, sortable filename such as `attendance-cse-2026-10-03.csv`. */
const fileNameFor = (report, req) => {
  const parts = [report.replace(/_/g, '-')];
  const department = req.user.role === 'admin' ? req.query.departmentId : req.user.departmentId;
  if (department) parts.push(String(department).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (req.query.semester) parts.push(`sem-${req.query.semester}`);
  if (req.query.subjectCode) parts.push(String(req.query.subjectCode).toLowerCase());
  if (DATE_BEARING.has(report) && req.query.from) parts.push(`from-${req.query.from}`);
  if (DATE_BEARING.has(report) && req.query.to) parts.push(`to-${req.query.to}`);
  return `${parts.join('-')}.csv`;
};

/** Shared server-side scoping + filtering used by both the preview and the download. */
const buildReport = async (report, req) => {
  const config = REPORTS[report];
  if (!config) throw badRequest('Unknown report.', { report: 'Not available' });

  // Admin may target any department; everyone else is pinned to their own.
  const requested = req.user.role === 'admin' ? String(req.query.departmentId || '') : '';
  if (req.user.role !== 'admin' && req.query.departmentId && String(req.query.departmentId) !== String(req.user.departmentId || '')) {
    throw forbidden('You can only download reports for your own department.');
  }
  const departmentId = req.user.role === 'admin' ? requested : String(req.user.departmentId || '');

  let rows = await dataFor[report]();

  // Faculty reports are restricted to subjects allocated to the caller.
  let allocatedCodes = null;
  if (req.user.role === 'faculty') {
    const me = await resolveFacultyRow(req.user);
    const mine = me ? await allocationsFor(me.facultyId) : [];
    allocatedCodes = new Set(mine.map((a) => String(a.subjectCode || '').toUpperCase()));
    if (req.query.subjectCode && !allocatedCodes.has(String(req.query.subjectCode).toUpperCase())) {
      throw forbidden('You are not allocated to that subject.');
    }
    rows = rows.filter((row) => {
      const code = String(row.subjectCode || '').toUpperCase();
      const own = row.facultyId && me && String(row.facultyId) === String(me.facultyId);
      return (code && allocatedCodes.has(code)) || own;
    });
  }

  // Department scope. Rows with no department column (users/announcements) are
  // only reachable by an admin.
  if (departmentId) {
    rows = rows.filter((row) => String(row.departmentId || '') === departmentId);
  } else if (req.user.role !== 'admin') {
    throw forbidden('No department is assigned to your account.');
  }

  if (req.query.semester) rows = rows.filter((row) => Number(row.semester) === Number(req.query.semester));
  if (req.query.subjectCode) {
    rows = rows.filter((row) => String(row.subjectCode || '').toUpperCase() === String(req.query.subjectCode).toUpperCase());
  }
  if (req.query.status) rows = rows.filter((row) => String(row.status || 'active').toLowerCase() === String(req.query.status).toLowerCase());
  if (DATE_BEARING.has(report)) {
    const key = report === 'assignments' ? 'assignedDate' : 'date';
    if (req.query.from) rows = rows.filter((row) => String(row[key] || '') >= String(req.query.from));
    if (req.query.to) rows = rows.filter((row) => String(row[key] || '') <= String(req.query.to));
  }
  if (req.query.search) rows = rows.filter((row) => dataService.matchesSearch(row, req.query.search, config.columns));

  const sorted = [...rows].sort(config.sort);
  return { config, departmentId, rows: sorted };
};

/** GET /api/reports — the report catalogue the HOD screen renders. */
router.get(
  '/',
  requireRole('admin', 'hod', 'faculty'),
  asyncHandler(async (req, res) => {
    const available = Object.entries(REPORTS)
      .filter(([, config]) => config.columns.length > 0)
      .map(([key, config]) => ({ key, label: config.label, columns: config.columns, dateRange: DATE_BEARING.has(key) }));
    return res.json({ success: true, message: 'Operation successful', data: available });
  })
);

/** GET /api/reports/:report — preview (already department scoped and filtered). */
router.get(
  '/:report',
  requireRole('admin', 'hod', 'faculty'),
  asyncHandler(async (req, res) => {
    const { config, rows } = await buildReport(String(req.params.report).toLowerCase(), req);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    return res.json({
      success: true,
      message: 'Operation successful',
      data: rows.slice(0, limit),
      total: rows.length,
      columns: config.columns,
    });
  })
);

/** GET /api/reports/:report/download — Excel-compatible CSV. */
router.get(
  '/:report/download',
  requireRole('admin', 'hod', 'faculty'),
  asyncHandler(async (req, res) => {
    const report = String(req.params.report).toLowerCase();
    const { config, rows } = await buildReport(report, req);
    const csv = toCsv(config.columns, rows);
    const name = fileNameFor(report, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    // Downloading a report is a data-egress event, so it is recorded.
    try {
      await appsScript.post('audit_log', {
        record: {
          action: 'download',
          resource: `Report:${report}`,
          recordId: name,
          performedBy: req.user.userId,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          departmentId: req.user.departmentId || req.query.departmentId || '',
          detail: `${rows.length} row(s), columns: ${config.columns.join(', ')}`,
        },
      }, actorOf(req));
    } catch (error) {
      // A failed audit write must not stop the download itself.
      // eslint-disable-next-line no-console
      console.error('[audit] failed to record report download', error.message);
    }
    return res.send(csv);
  })
);

module.exports = router;
module.exports.REPORTS = REPORTS;
module.exports.toCsv = toCsv;