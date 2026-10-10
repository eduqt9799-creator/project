const express = require('express');
const appsScript = require('../services/appsScriptClient');
const dataService = require('../services/dataService');
const { crudFactory } = require('../services/crudFactory');
const { SPECS } = require('../utils/validate');
const { asyncHandler, badRequest, forbidden, notFound } = require('../middleware/error');
const { requireRole } = require('../middleware/auth');
const { assertCanWriteForSubject } = require('../utils/facultyScope');
const { computeAssignmentStatus } = require('../services/assignmentStatus');

const router = express.Router();

const decorate = (row, submission) => ({
  ...row,
  status: computeAssignmentStatus(row, new Date(), submission),
  submission: submission
    ? {
        submissionId: submission.submissionId,
        submittedAt: submission.submittedAt,
        submissionNote: submission.submissionNote,
        fileUrl: submission.fileUrl,
        status: submission.status,
      }
    : null,
});

/** Resolves the signed-in student's profile row. */
const findSelf = async (req) => {
  const students = await dataService.students();
  return students.find(
    (s) =>
      String(s.email || '').toLowerCase() === String(req.user.email || '').toLowerCase() ||
      (req.user.studentId && String(s.studentId) === String(req.user.studentId))
  );
};

const findSubmission = (submissions, assignmentId, student) =>
  submissions.find(
    (s) =>
      String(s.assignmentId || '') === String(assignmentId) &&
      student &&
      (String(s.studentId || '') === String(student.studentId || '') ||
        String(s.registerNumber || '').toUpperCase() === String(student.registerNumber || '').toUpperCase())
  );

const studentSemesterScope = (row, req) => {
  if (req.user.role !== 'student') return true;
  const semester = req.user.profile && req.user.profile.semester !== undefined ? Number(req.user.profile.semester) : null;
  if (semester === null || Number.isNaN(semester)) return false;
  return Number(row.semester) === semester;
};

/** Student view: own assignments, each carrying only that student's submission. */
router.get(
  '/mine',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const me = await findSelf(req);
    const semester = me ? Number(me.semester) : null;
    const submissions = await dataService.assignmentSubmissions();
    const rows = (await dataService.assignments())
      .filter((r) => String(r.departmentId || '') === String(req.user.departmentId || ''))
      .filter((r) => (semester ? Number(r.semester) === semester : true))
      .filter((r) => (req.query.subjectCode ? String(r.subjectCode).toUpperCase() === String(req.query.subjectCode).toUpperCase() : true))
      .map((r) => decorate(r, findSubmission(submissions, r.assignmentId, me)))
      .filter((r) => (req.query.status ? r.status === String(req.query.status).toLowerCase() : true))
      .filter((r) => (req.query.search ? dataService.matchesSearch(r, req.query.search, ['title', 'description', 'subjectCode', 'subjectName']) : true))
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
    return res.json({ success: true, message: 'Operation successful', data: rows });
  })
);

/**
 * Staff view of who has submitted an assignment. Scoped to the caller's
 * department for HOD, and read-only.
 */
router.get(
  '/:id/submissions',
  requireRole('faculty', 'hod', 'admin'),
  asyncHandler(async (req, res) => {
    const rows = await dataService.assignments();
    const row = rows.find((r) => String(r.assignmentId || '') === String(req.params.id));
    if (!row) throw notFound('Assignment not found');
    if (req.user.role !== 'admin' && String(row.departmentId || '') !== String(req.user.departmentId || '')) {
      throw forbidden('You cannot view submissions outside your department.');
    }
    const submissions = await dataService.assignmentSubmissions();
    const mine = submissions
      .filter((s) => String(s.assignmentId || '') === String(req.params.id))
      .map((s) => ({
        submissionId: s.submissionId,
        studentId: s.studentId,
        registerNumber: s.registerNumber,
        studentName: s.studentName,
        submittedAt: s.submittedAt,
        submissionNote: s.submissionNote,
        fileUrl: s.fileUrl,
        status: s.status,
      }))
      .sort((a, b) => String(a.registerNumber || '').localeCompare(String(b.registerNumber || ''), undefined, { numeric: true }));
    return res.json({ success: true, message: 'Operation successful', data: mine, count: mine.length });
  })
);

/**
 * A faculty member may only create, edit or remove an assignment for a subject
 * currently allocated to them; HOD and admin keep department-wide control.
 * Re-checked on every write so a stale browser tab cannot slip past a change of
 * allocation.
 */
const guardAllocatedSubject = async (data, req, previous) => {
  if (req.user.role !== 'faculty') return;
  const subjectCode = data.subjectCode || (previous && previous.subjectCode);
  const semester = data.semester || (previous && previous.semester);
  if (!subjectCode || !semester) return;
  const departmentId = data.departmentId || (previous && previous.departmentId) || req.user.departmentId;
  await assertCanWriteForSubject(req.user, subjectCode, semester, departmentId);
};

router.use(
  crudFactory({
    resource: 'Assignment',
    table: 'assignments',
    idField: 'assignmentId',
    createSpec: { ...SPECS.assignment },
    updateSpec: { ...SPECS.assignment },
    listSpec: { semester: {}, subjectCode: {}, departmentId: {}, status: {} },
    searchFields: ['title', 'description', 'subjectCode', 'subjectName', 'assignedBy'],
    uniqueKeys: [],
    roles: {
      read: ['admin', 'hod', 'faculty', 'student'],
      create: ['admin', 'hod', 'faculty'],
      update: ['admin', 'hod', 'faculty'],
      delete: ['admin', 'hod', 'faculty'],
    },
    extraFilter: studentSemesterScope,
    beforeCreate: guardAllocatedSubject,
    beforeUpdate: guardAllocatedSubject,
    beforeDelete: (row, req) => guardAllocatedSubject({}, req, row),
    sort: (a, b) => String(b.assignedDate || '').localeCompare(String(a.assignedDate || '')),
    transformCreate: (data, req) => ({ ...data, assignedBy: req.user.name, assignedById: req.user.userId }),
  })
);

/**
 * Record the signed-in student's own submission.
 *
 * Writes one AssignmentSubmissions row keyed by (assignmentId, studentId) so
 * concurrent students never overwrite each other, and re-submitting updates
 * that single row instead of the shared assignment.
 */
router.post(
  '/:id/submit',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const rows = await dataService.assignments();
    const row = rows.find((r) => String(r.assignmentId || '') === String(req.params.id));
    if (!row) throw notFound('Assignment not found');
    if (String(row.departmentId || '') !== String(req.user.departmentId || '')) {
      throw forbidden('You cannot submit an assignment outside your department.');
    }

    const me = await findSelf(req);
    if (!me) throw forbidden('Your student profile is not linked to this login. Contact the administrator.');
    if (String(me.status || 'active').toLowerCase() !== 'active') {
      throw forbidden('Your account is deactivated.');
    }
    if (String(me.semester) !== String(row.semester)) {
      throw badRequest('This assignment belongs to a different semester.', { assignmentId: 'Not available for your semester' });
    }

    const note = String(req.body.submissionNote || '').trim();
    const fileUrl = String(req.body.fileUrl || '').trim();
    if (!note && !fileUrl) {
      throw badRequest('Add a submission note or a file link.', {
        submissionNote: 'Add a note or a file link',
        fileUrl: 'Add a note or a file link',
      });
    }
    if (fileUrl && !/^https?:\/\/\S+$/i.test(fileUrl)) {
      throw badRequest('The file link must be a full http(s) URL.', { fileUrl: 'Enter a valid URL' });
    }

    const result = await appsScript.post('save_assignment_submission', {
      record: {
        assignmentId: row.assignmentId,
        studentId: me.studentId,
        registerNumber: me.registerNumber,
        studentName: me.name,
        submittedAt: new Date().toISOString(),
        submissionNote: note,
        fileUrl,
        status: 'submitted',
        departmentId: row.departmentId,
      },
    });

    const submissions = await dataService.assignmentSubmissions();
    const submission = findSubmission(submissions, row.assignmentId, me);
    return res.json({
      success: true,
      message: 'Assignment submitted',
      data: decorate(row, submission || result.data).submission,
    });
  })
);

/** Withdraw the signed-in student's own submission (row is removed, not shared). */
router.delete(
  '/:id/submit',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const rows = await dataService.assignments();
    const row = rows.find((r) => String(r.assignmentId || '') === String(req.params.id));
    if (!row) throw notFound('Assignment not found');
    const me = await findSelf(req);
    if (!me) throw forbidden('Your student profile is not linked to this login. Contact the administrator.');
    const submissions = await dataService.assignmentSubmissions();
    const submission = findSubmission(submissions, row.assignmentId, me);
    if (!submission) throw notFound('You have not submitted this assignment.');
    await appsScript.post('delete_assignment_submission', { id: String(submission.submissionId) });
    return res.json({ success: true, message: 'Submission withdrawn' });
  })
);

module.exports = router;
module.exports.decorateAssignment = decorate;