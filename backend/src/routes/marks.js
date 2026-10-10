const router = require('express').Router();
const dataService = require('../services/dataService');
const { crudFactory } = require('../services/crudFactory');
const { SPECS } = require('../utils/validate');
const { asyncHandler, badRequest, forbidden } = require('../middleware/error');
const { requireRole } = require('../middleware/auth');
const { byRegisterNumber } = require('../utils/naturalSort');
const { assertCanWriteForSubject } = require('../utils/facultyScope');

const INTERNAL_MAX = 40;
const EXAM_MAX = 60;
const ASSIGNMENT_MAX = 20;

const withTotals = (row) => {
  const internal = Number(row.internalMark || 0);
  const exam = Number(row.examMark || 0);
  const assignment = Number(row.assignmentMark || 0);
  const total = internal + exam + assignment;
  const outOf = INTERNAL_MAX + EXAM_MAX + ASSIGNMENT_MAX;
  return {
    ...row,
    internalMark: internal,
    examMark: exam,
    assignmentMark: assignment,
    total,
    totalOutOf: outOf,
    percentage: outOf ? Number(((total / outOf) * 100).toFixed(2)) : 0,
    status: total >= 40 ? 'Pass' : 'Fail',
  };
};

/** Student: own marks only. */
router.get(
  '/mine',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const students = await dataService.students();
    const me = students.find((s) => String(s.email || '').toLowerCase() === String(req.user.email).toLowerCase());
    if (!me) throw forbidden('Student record not found for this account');
    const rows = (await dataService.marks())
      .filter((m) => String(m.registerNumber || '').toUpperCase() === String(me.registerNumber).toUpperCase())
      .filter((m) => (req.query.semester ? Number(m.semester) === Number(req.query.semester) : true))
      .filter((m) => (req.query.subjectCode ? String(m.subjectCode).toUpperCase() === String(req.query.subjectCode).toUpperCase() : true))
      .map(withTotals)
      .sort(byRegisterNumber);
    return res.json({ success: true, message: 'Operation successful', data: rows });
  })
);

/** Confirms the student belongs to the caller's department (and semester when supplied). */
const guardRoster = async (req, data) => {
  const students = await dataService.students();
  const scoped = students.filter((s) => {
    const departmentId = req.user.role === 'admin' ? data.departmentId || s.departmentId : req.user.departmentId || '';
    return String(s.departmentId || '') === String(departmentId);
  });
  const semesterOk = data.semester ? scoped.filter((s) => Number(s.semester) === Number(data.semester)) : scoped;
  const student = semesterOk.find((s) => String(s.registerNumber).toUpperCase() === String(data.registerNumber));
  if (!student) throw forbidden('That register number does not belong to your department/semester.');
  return student;
};

const guardMarkCaps = (data) => {
  if (Number(data.internalMark) > INTERNAL_MAX) throw badRequest(`Internal mark cannot exceed ${INTERNAL_MAX}.`, { internalMark: `Max ${INTERNAL_MAX}` });
  if (data.examMark !== undefined && Number(data.examMark) > EXAM_MAX) throw badRequest(`Exam mark cannot exceed ${EXAM_MAX}.`, { examMark: `Max ${EXAM_MAX}` });
  if (data.assignmentMark !== undefined && Number(data.assignmentMark) > ASSIGNMENT_MAX) {
    throw badRequest(`Assignment mark cannot exceed ${ASSIGNMENT_MAX}.`, { assignmentMark: `Max ${ASSIGNMENT_MAX}` });
  }
};

/**
 * Marks may only be recorded for a subject the faculty member currently holds an
 * active allocation for, so a teacher cannot mark another teacher's subject by
 * typing its code.
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
    resource: 'Marks',
    table: 'marks',
    idField: 'marksId',
    createSpec: { ...SPECS.marks, semester: SPECS.subject.semester },
    updateSpec: { ...SPECS.marks, semester: SPECS.subject.semester },
    listSpec: { semester: {}, subjectCode: {}, departmentId: {}, registerNumber: {} },
    searchFields: ['registerNumber', 'studentName', 'subjectCode', 'subjectName'],
    uniqueKeys: [['registerNumber', 'subjectCode', 'departmentId']],
    roles: {
      read: ['admin', 'hod', 'faculty'],
      create: ['admin', 'hod', 'faculty'],
      update: ['admin', 'hod', 'faculty'],
      delete: ['admin', 'hod'],
    },
    sort: byRegisterNumber,
    beforeCreate: async (data, req) => {
      guardMarkCaps(data);
      const student = await guardRoster(req, data);
      await guardAllocatedSubject(data, req, null);
      Object.assign(data, {
        studentName: student.name,
        studentId: student.studentId || '',
        departmentId: student.departmentId,
        departmentName: student.departmentName || '',
      });
    },
    beforeUpdate: async (data, req, previous) => {
      guardMarkCaps(data);
      await guardAllocatedSubject(data, req, previous);
    },
  })
);

module.exports = router;
module.exports.withTotals = withTotals;
module.exports.MARKS_MAX = { INTERNAL_MAX, EXAM_MAX, ASSIGNMENT_MAX };
module.exports.listSpec = { semester: {}, subjectCode: {}, departmentId: {}, registerNumber: {} };