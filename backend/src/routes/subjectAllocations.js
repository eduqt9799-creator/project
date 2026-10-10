const router = require('express').Router();
const dataService = require('../services/dataService');
const { crudFactory } = require('../services/crudFactory');
const { requireRole } = require('../middleware/auth');
const { asyncHandler, forbidden, badRequest } = require('../middleware/error');
const { SPECS } = require('../utils/validate');
const { bySemesterThenCode } = require('../utils/subjectOrder');

/**
 * Faculty subject allocation.
 *
 * An allocation is the single source of truth for "who teaches what": it drives
 * the faculty dashboard, the student's My Teachers view, and the set of
 * subjects a faculty member may post materials/assignments/attendance for.
 * Only an HOD (or admin) may create, reassign or remove one, and always only
 * inside their own department.
 */

/** Allocation joined to the live faculty row, so a renamed teacher shows correctly. */
const withFaculty = (row, facultyById) => {
  const faculty = facultyById.get(String(row.facultyId || ''));
  return {
    ...row,
    facultyId: row.facultyId || '',
    facultyName: faculty ? faculty.name : row.facultyName || 'Unknown faculty',
    facultyEmail: faculty ? faculty.email || '' : '',
    facultyDesignation: faculty ? faculty.designation || '' : '',
    facultyStatus: faculty ? faculty.status || 'active' : 'missing',
  };
};

const allocationsWithFaculty = async (rows) => {
  const faculty = await dataService.faculty();
  const byId = new Map(faculty.map((f) => [String(f.facultyId || ''), f]));
  return rows.map((row) => withFaculty(row, byId));
};

/**
 * GET /api/subject-allocations/mine
 * Faculty dashboard: only the subjects actually assigned to the caller.
 * A faculty member with no allocations gets an empty list, never the whole department.
 */
router.get(
  '/mine',
  requireRole('faculty', 'hod', 'admin'),
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
      const me = await dataService.faculty();
      const own = me.filter((f) => String(f.email || '').toLowerCase() === String(req.user.email || '').toLowerCase());
      const ids = new Set(own.map((f) => String(f.facultyId || '')));
      const rows = (await dataService.subjectAllocations()).filter((a) =>
        ids.has(String(a.facultyId || '')) && String(a.status || 'active').toLowerCase() === 'active'
      );
      const enriched = await allocationsWithFaculty(rows);
      return res.json({
        success: true,
        message: 'Operation successful',
        data: enriched.sort(bySemesterThenCode),
        facultyId: String((own[0] || {}).facultyId || ''),
      });
    }
    const rows = (await dataService.subjectAllocations()).filter(
      (a) => String(a.status || 'active').toLowerCase() === 'active'
    );
    return res.json({ success: true, message: 'Operation successful', data: await allocationsWithFaculty(rows) });
  })
);

/**
 * GET /api/subject-allocations/teachers
 * Student "My Department / My Teachers": resolves the HOD plus the faculty
 * actually allocated to each subject in the student's own semester. Everything
 * comes from SubjectAllocations + Faculty rows — nothing is hardcoded.
 */
router.get(
  '/teachers',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const students = await dataService.students();
    const me = students.find(
      (s) => String(s.email || '').toLowerCase() === String(req.user.email || '').toLowerCase()
    );
    if (!me) throw forbidden('Your student record could not be found. Please contact your department administrator.');

    const departmentId = String(me.departmentId || req.user.departmentId || '');
    const semester = Number(me.semester);
    if (!departmentId) throw forbidden('Your account is not linked to a department.');

    const [hods, allocations, subjects] = await Promise.all([
      dataService.hods().catch(() => []),
      dataService.subjectAllocations(),
      dataService.subjects(),
    ]);

    const hod = hods
      .filter((h) => String(h.departmentId || '') === departmentId)
      .filter((h) => String(h.status || 'active').toLowerCase() === 'active')[0] || null;

    const activeAllocations = allocations.filter(
      (a) =>
        String(a.status || 'active').toLowerCase() === 'active' &&
        String(a.departmentId || '') === departmentId &&
        Number(a.semester) === semester
    );

    const subjectByCode = new Map(
      subjects
        .filter((s) => String(s.departmentId || '') === departmentId && Number(s.semester) === semester)
        .map((s) => [String(s.subjectCode || '').toUpperCase(), s])
    );

    // Start from the department's subjects for this semester so a subject still
    // shows (with an "unassigned" teacher) when the HOD has not allocated it yet.
    const codes = new Set([
      ...subjectByCode.keys(),
      ...activeAllocations.map((a) => String(a.subjectCode || '').toUpperCase()),
    ]);

    const enriched = await allocationsWithFaculty(activeAllocations);
    const allocationByCode = new Map(enriched.map((a) => [String(a.subjectCode || '').toUpperCase(), a]));

    const teaching = [...codes]
      .map((code) => {
        const subject = subjectByCode.get(code);
        const allocation = allocationByCode.get(code);
        return {
          subjectCode: code,
          subjectName: (subject && subject.subjectName) || (allocation && allocation.subjectName) || '',
          credits: subject ? Number(subject.credits || 0) : 0,
          facultyId: allocation ? allocation.facultyId : '',
          facultyName: allocation ? allocation.facultyName : '',
          facultyEmail: allocation ? allocation.facultyEmail : '',
          facultyDesignation: allocation ? allocation.facultyDesignation : '',
          allocationId: allocation ? allocation.allocationId : '',
          assigned: Boolean(allocation),
        };
      })
      .sort(bySemesterThenCode);

    return res.json({
      success: true,
      message: 'Operation successful',
      data: {
        student: {
          studentId: me.studentId,
          name: me.name,
          registerNumber: me.registerNumber,
          semester: Number(me.semester),
          batch: me.batch || '',
          departmentId,
          departmentName: me.departmentName || '',
        },
        hod: hod
          ? {
              hodId: hod.hodId,
              name: hod.name,
              email: hod.email || '',
              phone: hod.phone || '',
              designation: hod.designation || '',
              departmentId: hod.departmentId,
              departmentName: hod.departmentName || '',
            }
          : null,
        subjects: teaching,
      },
    });
  })
);

/**
 * Guards a write: only an HOD/admin may allocate, and a faculty member may only
 * be allocated subjects that exist in the acting department + semester.
 */
const assertAllocatable = async (data, req) => {
  if (req.user.role !== 'admin' && !req.user.departmentId) {
    throw forbidden('No department is assigned to your account.');
  }
  const departmentId = req.user.role === 'admin' ? String(data.departmentId || '') : req.user.departmentId;
  // An admin manages every department, so it must still state which one.
  if (!departmentId) {
    throw badRequest('Select the department this allocation belongs to.', { departmentId: 'Department is required' });
  }

  const faculty = await dataService.faculty();
  const target = faculty.find(
    (f) =>
      String(f.facultyId || '') === String(data.facultyId || '') &&
      (req.user.role === 'admin' || String(f.departmentId || '') === departmentId)
  );
  if (!target) throw badRequest('Select a faculty member from your own department.', { facultyId: 'Not in your department' });
  if (String(target.status || 'active').toLowerCase() !== 'active') {
    throw badRequest('That faculty member is deactivated and cannot receive subjects.', { facultyId: 'Account inactive' });
  }

  const subjects = await dataService.subjects();
  const subject = subjects.find(
    (s) =>
      String(s.subjectCode || '').toUpperCase() === String(data.subjectCode || '').toUpperCase() &&
      Number(s.semester) === Number(data.semester) &&
      (req.user.role === 'admin' || String(s.departmentId || '') === departmentId)
  );
  if (!subject) {
    throw badRequest('That subject does not exist for this semester in your department.', {
      subjectCode: 'Unknown subject for this semester',
    });
  }

  // Denormalise the display names from the authoritative rows.
  data.subjectName = subject.subjectName;
  data.facultyName = target.name;
  data.departmentId = departmentId;
  data.departmentName = target.departmentName || '';
  data.status = data.status || 'active';
  data.assignedDate = data.assignedDate || new Date().toISOString().slice(0, 10);
  return { faculty: target, subject };
};

/**
 * Deleting an allocation that students already have content for would silently
 * orphan that content, so it is refused with actionable guidance instead.
 */
const assertNoAcademicDependents = async (row) => {
  const code = String(row.subjectCode || '').toUpperCase();
  const matches = (other) =>
    String(other.facultyId || '') === String(row.facultyId || '') &&
    code &&
    String(other.subjectCode || '').toUpperCase() === code;
  const [materials, assignments] = await Promise.all([
    dataService.materials().catch(() => []),
    dataService.assignments().catch(() => []),
  ]);
  const blockers = [];
  if (materials.some(matches)) blockers.push('materials');
  if (assignments.some(matches)) blockers.push('assignments');
  if (blockers.length) {
    throw badRequest(
      `This allocation already has ${blockers.join(' and ')} published for it. Deactivate the allocation instead of deleting it, or reassign the subject to another faculty member.`,
      { status: 'Has dependent records' }
    );
  }
};

router.use(
  crudFactory({
    resource: 'Subject allocation',
    table: 'subjectAllocations',
    idField: 'allocationId',
    createSpec: { ...SPECS.subjectAllocation },
    updateSpec: { ...SPECS.subjectAllocation },
    listSpec: { semester: {}, subjectCode: {}, facultyId: {}, status: {}, departmentId: {} },
    searchFields: ['subjectCode', 'subjectName', 'facultyName', 'facultyId', 'departmentName'],
    createAction: 'create_subject_allocation',
    updateAction: 'update_subject_allocation',
    deleteAction: 'delete_subject_allocation',
    uniqueKeys: [['departmentId', 'semester', 'subjectCode', 'facultyId']],
    roles: {
      read: ['admin', 'hod', 'faculty'],
      create: ['admin', 'hod'],
      update: ['admin', 'hod'],
      delete: ['admin', 'hod'],
    },
    beforeDelete: async (row) => {
      if (String(row.status || 'active').toLowerCase() !== 'active') return;
      await assertNoAcademicDependents(row);
    },
    sort: bySemesterThenCode,
    beforeCreate: async (data, req) => {
      await assertAllocatable(data, req);
      data.assignedBy = req.user.name;
      data.assignedById = req.user.userId;
    },
    beforeUpdate: async (data, req, existing) => {
      // Updates are partial, so validate the merged row but only write back the
      // derived display names when a key field actually changes.
      const merged = { ...(existing || {}), ...data };
      await assertAllocatable(merged, req);
      if (['facultyId', 'subjectCode', 'semester', 'departmentId'].some((key) => key in data)) {
        data.subjectName = merged.subjectName;
        data.facultyName = merged.facultyName;
        data.departmentName = merged.departmentName;
      }
    },
  })
);

module.exports = router;