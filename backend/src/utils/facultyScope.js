const dataService = require('../services/dataService');
const { forbidden, badRequest } = require('../middleware/error');

/**
 * Faculty subject-allocation scope.
 *
 * Everything a faculty member is allowed to *write* (materials, assignments,
 * attendance, marks) is decided here from SubjectAllocations, so "which subjects
 * can this teacher touch" is defined in exactly one place and cannot drift
 * between modules.
 */

const isAdmin = (user) => user.role === 'admin';

/** The Faculty row that belongs to the authenticated account. */
const resolveFacultyRow = async (user) => {
  const rows = await dataService.faculty();
  const email = String(user.email || '').toLowerCase();
  return (
    rows.find((f) => String(f.email || '').toLowerCase() === email) ||
    rows.find((f) => user.userId && String(f.facultyId || '') === String(user.userId)) ||
    null
  );
};

/** Active allocations for one faculty member, optionally narrowed to a semester. */
const allocationsFor = async (facultyId, semester) => {
  const all = await dataService.subjectAllocations();
  return all.filter((a) => {
    if (String(a.facultyId || '') !== String(facultyId || '')) return false;
    if (String(a.status || 'active').toLowerCase() !== 'active') return false;
    if (semester !== undefined && semester !== null && semester !== '' && Number(a.semester) !== Number(semester)) return false;
    return true;
  });
};

/**
 * Throws unless `user` may write content for this subject+semester.
 *
 * admin  -> anything inside the department they target
 * hod    -> anything in their own department
 * faculty-> ONLY subjects currently allocated to them
 */
const assertCanWriteForSubject = async (user, subjectCode, semester, departmentId) => {
  const code = String(subjectCode || '').trim().toUpperCase();
  if (!code) throw badRequest('A subject code is required.', { subjectCode: 'Subject is required' });

  const targetDepartment = isAdmin(user) ? departmentId || '' : user.departmentId || '';
  if (!isAdmin(user) && !targetDepartment) {
    throw forbidden('No department is assigned to your account.');
  }

  if (user.role !== 'faculty') {
    // HOD / admin: the subject must still exist in that department + semester.
    const subjects = await dataService.subjects();
    const exists = subjects.some(
      (s) =>
        String(s.subjectCode || '').toUpperCase() === code &&
        Number(s.semester) === Number(semester) &&
        (isAdmin(user) ? !targetDepartment || String(s.departmentId || '') === targetDepartment : String(s.departmentId || '') === targetDepartment)
    );
    if (!exists) {
      throw badRequest('That subject does not exist for this semester in your department.', {
        subjectCode: 'Unknown subject for this semester',
      });
    }
    return { departmentId: targetDepartment };
  }

  const me = await resolveFacultyRow(user);
  if (!me) throw forbidden('No faculty record is linked to your account. Please contact your HOD.');

  const mine = await allocationsFor(me.facultyId, semester);
  const allocated = mine.find((a) => String(a.subjectCode || '').toUpperCase() === code);
  if (!allocated) {
    throw forbidden('You are not allocated to that subject for this semester. Ask your HOD to allocate it first.', {
      subjectCode: 'Subject not allocated to you',
    });
  }
  return { faculty: me, allocation: allocated, departmentId: targetDepartment || allocated.departmentId || '' };
};

/** Subject codes a faculty member may act on, for populating dropdowns. */
const teachableSubjects = async (user) => {
  if (user.role === 'faculty') {
    const me = await resolveFacultyRow(user);
    if (!me) return [];
    const mine = await allocationsFor(me.facultyId);
    const subjects = await dataService.subjects();
    const byCode = new Map(subjects.map((s) => [String(s.subjectCode || '').toUpperCase(), s]));
    return mine.map((a) => {
      const code = String(a.subjectCode || '').toUpperCase();
      const subject = byCode.get(code);
      return {
        subjectCode: code,
        subjectName: (subject && subject.subjectName) || a.subjectName || '',
        semester: Number(a.semester),
        credits: subject ? Number(subject.credits || 0) : 0,
        departmentId: a.departmentId || '',
        allocationId: a.allocationId || '',
      };
    });
  }
  if (user.role === 'admin' || user.role === 'hod') {
    const subjects = await dataService.subjects();
    const departmentId = user.departmentId || '';
    return subjects
      .filter((s) => isAdmin(user) || String(s.departmentId || '') === departmentId)
      .filter((s) => String(s.status || 'active').toLowerCase() === 'active')
      .map((s) => ({
        subjectCode: String(s.subjectCode || '').toUpperCase(),
        subjectName: s.subjectName || '',
        semester: Number(s.semester),
        credits: Number(s.credits || 0),
        departmentId: s.departmentId || '',
        allocationId: '',
      }));
  }
  return [];
};

module.exports = { resolveFacultyRow, allocationsFor, assertCanWriteForSubject, teachableSubjects };