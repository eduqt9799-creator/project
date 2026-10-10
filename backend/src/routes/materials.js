const router = require('express').Router();
const dataService = require('../services/dataService');
const { crudFactory } = require('../services/crudFactory');
const { asyncHandler, forbidden } = require('../middleware/error');
const { SPECS } = require('../utils/validate');
const { bySemesterThenCode } = require('../utils/subjectOrder');
const {
  assertCanWriteForSubject,
  resolveFacultyRow,
  allocationsFor,
  teachableSubjects,
} = require('../utils/facultyScope');

/**
 * Study materials.
 *
 * A faculty member can publish material only for a subject currently allocated to
 * them (`assertCanWriteForSubject`), and the uploader is stamped from the
 * authenticated account rather than the submitted form, so ownership cannot be
 * forged by editing the request body.
 */

const code = (value) => String(value || '').trim().toUpperCase();

/**
 * Who may see a given material row.
 *
 * admin / hod -> everything inside their department scope (handled by the factory)
 * faculty     -> own uploads, plus anything for a subject allocated to them.
 *                `visibility: hod` means staff-only, so other faculty see it too.
 * student     -> same semester only, and never staff-only visibility.
 */
const visibleTo = (row, user, context = {}) => {
  if (user.role === 'admin' || user.role === 'hod') return true;

  if (user.role === 'faculty') {
    if (String(row.visibility || 'all').toLowerCase() === 'hod') return true;
    if (context.facultyId && String(row.facultyId || '') === String(context.facultyId)) return true;
    return Boolean(context.allocatedCodes && context.allocatedCodes.has(code(row.subjectCode)));
  }

  // student
  const visibility = String(row.visibility || 'all').toLowerCase();
  if (visibility === 'faculty' || visibility === 'hod') return false;
  if (row.semester === undefined || row.semester === '' || !context.semester) return true;
  return Number(row.semester) === Number(context.semester);
};

/**
 * GET /api/materials/mine
 * Faculty: only material the caller uploaded — never the whole department.
 */
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const me = await resolveFacultyRow(req.user);
    if (!me) {
      return res.json({ success: true, message: 'Operation successful', data: [], pagination: { total: 0 } });
    }
    const rows = (await dataService.materials()).filter(
      (m) => String(m.facultyId || '') === String(me.facultyId || '')
    );
    return res.json({
      success: true,
      message: 'Operation successful',
      data: rows.sort(bySemesterThenCode),
      pagination: { total: rows.length },
    });
  })
);

/**
 * GET /api/materials/teachable
 * The subject dropdown a faculty member may publish against: allocated subjects only.
 */
router.get(
  '/teachable',
  asyncHandler(async (req, res) => {
    const subjects = await teachableSubjects(req.user);
    return res.json({ success: true, message: 'Operation successful', data: subjects });
  })
);

const isOwnUpload = async (row, req) => {
  const me = await resolveFacultyRow(req.user);
  return Boolean(me) && String(row.facultyId || '') === String(me.facultyId || '');
};

router.use(
  crudFactory({
    resource: 'Material',
    table: 'materials',
    idField: 'materialId',
    createAction: 'create_material',
    updateAction: 'update_material',
    deleteAction: 'delete_material',
    createSpec: { ...SPECS.material },
    updateSpec: { ...SPECS.material },
    listSpec: { semester: {}, subjectCode: {}, departmentId: {}, visibility: {} },
    searchFields: ['title', 'description', 'subjectCode', 'subjectName', 'uploadedBy', 'facultyName', 'fileName'],
    uniqueKeys: [],
    roles: {
      read: ['admin', 'hod', 'faculty', 'student'],
      create: ['admin', 'hod', 'faculty'],
      update: ['admin', 'hod', 'faculty'],
      delete: ['admin', 'hod', 'faculty'],
    },
    /** Resolves the caller's faculty id / allocated subjects once per read. */
    extraFilter: async (row, req) => {
      if (req.user.role === 'admin' || req.user.role === 'hod') return true;
      const context = {};
      if (req.user.role === 'student') {
        const profile = req.user.profile || {};
        context.semester = Number(profile.semester) || 0;
        context.departmentId = String(profile.departmentId || req.user.departmentId || '');
        if (!req._studentSubjectCodes) {
          const subjects = await dataService.subjects();
          const dept = context.departmentId;
          const sem = context.semester;
          req._studentSubjectCodes = new Set(
            subjects
              .filter(s => (!dept || String(s.departmentId || '') === dept) && Number(s.semester) === sem)
              .map(s => String(s.subjectCode || '').trim().toUpperCase())
          );
        }
        const rowCode = String(row.subjectCode || '').trim().toUpperCase();
        const rowDept = String(row.departmentId || '');
        const rowSem = Number(row.semester);
        if (context.departmentId && rowDept && rowDept !== context.departmentId) return false;
        if (!isNaN(rowSem) && rowSem !== context.semester) return false;
        if (req._studentSubjectCodes.size > 0 && !req._studentSubjectCodes.has(rowCode)) return false;
        return visibleTo(row, req.user, context);
      }
      const me = await resolveFacultyRow(req.user);
      if (!me) return false;
      context.facultyId = me.facultyId;
      const allocated = await allocationsFor(me.facultyId);
      context.allocatedCodes = new Set(allocated.map((a) => code(a.subjectCode)));
      return visibleTo(row, req.user, context);
    },
    beforeCreate: async (data, req) => {
      const scoped = await assertCanWriteForSubject(req.user, data.subjectCode, data.semester, data.departmentId);
      data.departmentId = scoped.departmentId;
      if (scoped.faculty) {
        // Faculty upload: ownership comes from the authenticated account.
        data.facultyId = scoped.faculty.facultyId;
        data.facultyName = scoped.faculty.name;
        data.uploadedBy = scoped.faculty.name;
        data.uploadedById = scoped.faculty.facultyId;
      } else {
        // HOD / admin upload on behalf of the department.
        data.facultyId = '';
        data.facultyName = '';
        data.uploadedBy = req.user.name;
        data.uploadedById = req.user.userId;
      }
      data.visibility = data.visibility || 'all';
      data.uploadedDate = data.uploadedDate || new Date().toISOString().slice(0, 10);
      data.uploadDate = data.uploadDate || data.uploadedDate;
      data.status = data.status || 'active';
    },
    beforeUpdate: async (data, req, existing) => {
      if (req.user.role === 'faculty' && !(await isOwnUpload(existing, req))) {
        throw forbidden('You can only edit material that you uploaded.');
      }
      // Re-check allocation when the upload is moved to a different subject.
      if (data.subjectCode !== undefined && code(data.subjectCode) !== code(existing.subjectCode)) {
        await assertCanWriteForSubject(
          req.user,
          data.subjectCode,
          data.semester !== undefined ? data.semester : existing.semester,
          data.departmentId !== undefined ? data.departmentId : existing.departmentId
        );
      }
      // Never let the client rewrite who uploaded the material.
      delete data.facultyId;
      delete data.facultyName;
      delete data.uploadedBy;
      delete data.uploadedById;
    },
    beforeDelete: async (row, req) => {
      if (req.user.role === 'faculty' && !(await isOwnUpload(row, req))) {
        throw forbidden('You can only remove material that you uploaded.');
      }
    },
    sort: (a, b) =>
      bySemesterThenCode(a, b) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  })
);

module.exports = router;
module.exports.visibleTo = visibleTo;