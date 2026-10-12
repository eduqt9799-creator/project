/**
 * Students must only ever see records for their own semester.
 *
 * The signed-in student's profile is resolved once per request and cached on
 * `req.profile` so several routes can share it. If the profile cannot be
 * resolved (for example before the account is linked) the row is hidden
 * rather than exposed.
 */
const loadStudentProfile = async (req, dataService) => {
  if (req.profile !== undefined) return req.profile;
  if (req.user.role !== 'student') {
    req.profile = null;
    return req.profile;
  }
  const students = await dataService.students();
  const profile =
    students.find(
      (s) =>
        String(s.email || '').toLowerCase() === String(req.user.email || '').toLowerCase() ||
        (req.user.studentId && String(s.studentId) === String(req.user.studentId))
    ) || null;
  req.profile = profile;
  // Cached on the user object too, because JWT payloads only carry a snapshot
  // of the profile taken at login time.
  req.user.profile = profile;
  return req.profile;
};

/**
 * crudFactory `extraFilter` for routes students can read.
 * Admins, HODs and faculty see their whole scope.
 */
const studentSemesterScope = async (row, req, dataService) => {
  if (req.user.role !== 'student') return true;
  const profile = await loadStudentProfile(req, dataService);
  const semester = profile ? Number(profile.semester) : null;
  if (semester === null || !Number.isFinite(semester)) return false;
  if (row.semester === undefined || row.semester === '') return true;
  return Number(row.semester) === semester;
};

module.exports = { loadStudentProfile, studentSemesterScope };