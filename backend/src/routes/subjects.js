const router = require('express').Router();
const dataService = require('../services/dataService');
const { crudFactory } = require('../services/crudFactory');
const { SPECS } = require('../utils/validate');
const { asyncHandler } = require('../middleware/error');
const { bySemesterThenCode } = require('../utils/subjectOrder');

router.get(
  '/lookup',
  asyncHandler(async (req, res) => {
    const subjects = await dataService.subjects();
    const scoped =
      req.user.role === 'admin'
        ? subjects
        : subjects.filter((s) => String(s.departmentId || '') === String(req.user.departmentId || ''));
    const semester = req.query.semester ? Number(req.query.semester) : null;
    const rows = scoped
      .filter((s) => (semester ? Number(s.semester) === semester : true))
      .filter((s) => (req.query.search ? dataService.matchesSearch(s, req.query.search, ['subjectCode', 'subjectName']) : true))
      .filter((s) => (req.query.status ? String(s.status || 'active').toLowerCase() === String(req.query.status).toLowerCase() : true))
      .sort(bySemesterThenCode)
      .map((s) => ({
        subjectId: s.subjectId,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        semester: Number(s.semester),
        credits: Number(s.credits || 0),
        departmentId: s.departmentId,
        departmentName: s.departmentName,
        status: s.status || 'active',
      }));
    return res.json({ success: true, message: 'Operation successful', data: rows });
  })
);

router.use(
  crudFactory({
    resource: 'Subject',
    table: 'subjects',
    idField: 'subjectId',
    createSpec: { ...SPECS.subject },
    updateSpec: { ...SPECS.subject },
    listSpec: { semester: {}, status: {}, departmentId: {}, subjectCode: {} },
    searchFields: ['subjectCode', 'subjectName', 'departmentName', 'departmentCode'],
    uniqueKeys: [['subjectCode', 'semester', 'departmentId']],
    roles: {
      read: ['admin', 'hod', 'faculty'],
      create: ['admin', 'hod'],
      update: ['admin', 'hod'],
      delete: ['admin'],
    },
    requiredReferences: [
      { table: 'attendance', field: 'subjectCode', matchField: 'subjectCode', label: 'attendance records' },
      { table: 'marks', field: 'subjectCode', matchField: 'subjectCode', label: 'marks records' },
      { table: 'materials', field: 'subjectCode', matchField: 'subjectCode', label: 'study materials' },
    ],
    sort: bySemesterThenCode,
  })
);

module.exports = router;