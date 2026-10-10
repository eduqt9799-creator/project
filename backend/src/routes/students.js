const router = require('express').Router();
const dataService = require('../services/dataService');
const { crudFactory } = require('../services/crudFactory');
const { syncProfileAccount } = require('../services/accountService');
const { requireRole } = require('../middleware/auth');
const { SPECS, withoutPassword } = require('../utils/validate');
const { byRegisterNumber } = require('../utils/naturalSort');
const { asyncHandler, forbidden } = require('../middleware/error');
const { resolveFacultyRow, allocationsFor } = require('../utils/facultyScope');

// A blank password on update means "keep the current password".
const STUDENT_CREATE = { ...SPECS.student };
const STUDENT_UPDATE = withoutPassword(SPECS.student);

const syncAccount = (resource) => async ({ record, previous, password, action }) => {
  await syncProfileAccount({ resource, record: { ...(previous || {}), ...record }, previous, password, action });
};

/**
 * Student lookup is for pick-lists used by staff (marks, attendance rosters).
 * Students must never be able to enumerate the department roster, so the route
 * is restricted to faculty, HOD and admin.
 */
router.get(
  '/lookup',
  requireRole('admin', 'hod', 'faculty'),
  asyncHandler(async (req, res) => {
    const students = await dataService.students();
    const scoped =
      req.user.role === 'admin'
        ? students
        : students.filter((s) => String(s.departmentId || '') === String(req.user.departmentId || ''));
    const semester = req.query.semester ? Number(req.query.semester) : null;
    const rows = scoped
      .filter((s) => (semester ? Number(s.semester) === semester : true))
      .filter((s) => (req.query.status ? String(s.status || 'active').toLowerCase() === String(req.query.status).toLowerCase() : true))
      .filter((s) => (req.query.search ? dataService.matchesSearch(s, req.query.search, ['name', 'registerNumber']) : true))
      .sort(byRegisterNumber)
      .map((s) => ({
        studentId: s.studentId,
        registerNumber: s.registerNumber,
        name: s.name,
        semester: Number(s.semester),
        departmentId: s.departmentId,
        departmentName: s.departmentName,
        status: s.status || 'active',
      }));
    return res.json({ success: true, message: 'Operation successful', data: rows });
  })
);

/**
 * GET /api/students/mine
 * Faculty "My Students": the students of the subjects currently allocated to the
 * caller, in ascending register-number order.
 *
 * A faculty member never receives the whole department roster — the semesters
 * come from SubjectAllocations, so unallocated semesters stay hidden.
 */
router.get(
  '/mine',
  requireRole('faculty', 'hod', 'admin'),
  asyncHandler(async (req, res) => {
    const subjectCode = req.query.subjectCode ? String(req.query.subjectCode).trim().toUpperCase() : '';
    const semesterFilter = req.query.semester ? Number(req.query.semester) : null;
    const term = req.query.search ? String(req.query.search) : '';

    const students = await dataService.students();
    let scoped = req.user.role === 'admin' ? students : students.filter((s) => String(s.departmentId || '') === String(req.user.departmentId || ''));

    let allocatedSemesters = null;
    let allocation = null;
    if (req.user.role === 'faculty') {
      const me = await resolveFacultyRow(req.user);
      if (!me) {
        return res.json({ success: true, message: 'Operation successful', data: [], pagination: { total: 0 } });
      }
      const mine = await allocationsFor(me.facultyId);
      allocation = subjectCode ? mine.find((a) => String(a.subjectCode || '').toUpperCase() === subjectCode) || null : null;
      if (subjectCode && !allocation) {
        throw forbidden('You are not allocated to that subject. Ask your HOD to allocate it first.');
      }
      allocatedSemesters = new Set(
        (allocation ? [allocation] : mine).map((a) => Number(a.semester)).filter((n) => !Number.isNaN(n))
      );
      scoped = scoped.filter((s) => allocatedSemesters.has(Number(s.semester)));
    }

    if (allocation) scoped = scoped.filter((s) => Number(s.semester) === Number(allocation.semester));
    if (semesterFilter) scoped = scoped.filter((s) => Number(s.semester) === semesterFilter);
    if (req.query.status) scoped = scoped.filter((s) => String(s.status || 'active').toLowerCase() === String(req.query.status).toLowerCase());
    if (term) scoped = scoped.filter((s) => dataService.matchesSearch(s, term, ['name', 'registerNumber', 'email', 'batch']));

    const rows = [...scoped]
      .sort(byRegisterNumber)
      .map((s) => ({
        studentId: s.studentId,
        registerNumber: s.registerNumber,
        name: s.name,
        email: s.email || '',
        semester: Number(s.semester),
        batch: s.batch || '',
        departmentId: s.departmentId,
        departmentName: s.departmentName || '',
        status: s.status || 'active',
      }));

    const { rows: pageRows, pagination } = dataService.paginate(rows, req.query.page, req.query.limit || 200);
    return res.json({
      success: true,
      message: 'Operation successful',
      data: pageRows,
      pagination,
      semesters: allocatedSemesters ? [...allocatedSemesters].sort((a, b) => a - b) : null,
      subject: allocation ? { subjectCode: allocation.subjectCode, subjectName: allocation.subjectName, semester: Number(allocation.semester) } : null,
    });
  })
);

router.use(
  crudFactory({
    resource: 'Student',
    table: 'students',
    idField: 'studentId',
    createSpec: STUDENT_CREATE,
    updateSpec: STUDENT_UPDATE,
    listSpec: { semester: {}, status: {}, departmentId: {}, batch: {} },
    searchFields: ['name', 'registerNumber', 'email', 'phone', 'batch', 'departmentName', 'departmentCode'],
    uniqueKeys: [['registerNumber'], ['email']],
    roles: {
      read: ['admin', 'hod', 'faculty'],
      create: ['admin', 'hod'],
      update: ['admin', 'hod'],
      delete: ['admin', 'hod'],
    },
    requiredReferences: [
      { table: 'attendance', field: 'registerNumber', matchField: 'registerNumber', label: 'attendance records' },
      { table: 'marks', field: 'registerNumber', matchField: 'registerNumber', label: 'marks records' },
    ],
    // Every student profile owns a login account, so creating a student must
    // provision the matching Users row with a bcrypt hashed password.
    afterCreate: syncAccount('Student'),
    afterUpdate: syncAccount('Student'),
    afterDelete: syncAccount('Student'),
    sort: byRegisterNumber,
  })
);

module.exports = router;