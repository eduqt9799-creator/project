const router = require('express').Router();
const dataService = require('../services/dataService');
const { toBool } = dataService;
const { asyncHandler } = require('../middleware/error');
const { requireRole } = require('../middleware/auth');
const { byRegisterNumber } = require('../utils/naturalSort');
const { withTotals, MARKS_MAX } = require('./marks');
const { computeAssignmentStatus } = require('../services/assignmentStatus');
const { SINGLE_DEPARTMENT } = require('../config/department');

const countBy = (rows) => rows.length;

/**
 * A deployment may not provide every optional module (the lightweight Apps
 * Script has no HODs / Exams / Notifications sheets). One absent module must not
 * blank the whole dashboard, so treat an unsupported table as "no records" and
 * report which modules were unavailable instead of failing the request.
 */
const load = async (label, loader, unavailable) => {
  try {
    return await loader();
  } catch (error) {
    if (error && error.reason === 'table_not_supported') {
      unavailable.push(label);
      return [];
    }
    throw error;
  }
};

/** All dashboard values are computed from real Google Sheets data. Never hardcoded. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const unavailable = [];
    const [departments, students, faculty, hods, subjects, allocations, attendance, materials, assignments, marks, timetable, exams, announcements, notifications] =
      await Promise.all([
        load('departments', () => dataService.departments(), unavailable),
        load('students', () => dataService.students(), unavailable),
        load('faculty', () => dataService.faculty(), unavailable),
        load('HODs', () => dataService.hods(), unavailable),
        load('subjects', () => dataService.subjects(), unavailable),
        load('SubjectAllocations', () => dataService.subjectAllocations(), unavailable),
        load('attendance', () => dataService.attendance(), unavailable),
        load('materials', () => dataService.materials(), unavailable),
        load('assignments', () => dataService.assignments(), unavailable),
        load('marks', () => dataService.marks(), unavailable),
        load('timetable', () => dataService.timetable(), unavailable),
        load('exams', () => dataService.exams(), unavailable),
        load('announcements', () => dataService.announcements(), unavailable),
        load('notifications', () => dataService.notifications(), unavailable),
      ]);

    const { role, departmentId } = req.user;
    const isAdmin = role === 'admin';
    const inDept = (row) => (isAdmin ? true : String(row.departmentId || '') === String(departmentId || ''));

    const dStudents = students.filter(inDept);
    const dFaculty = faculty.filter(inDept);
    const dHods = hods.filter(inDept);
    const dSubjects = subjects.filter(inDept);
    const dAllocations = allocations.filter(inDept);
    const dAttendance = attendance.filter(inDept);
    const dMaterials = materials.filter(inDept);
    const dAssignments = assignments.filter(inDept);
    const dMarks = marks.filter(inDept);
    const dTimetable = timetable.filter(inDept);
    const dExams = exams.filter(inDept);
    const dAnnouncements = announcements.filter(inDept);
    const dNotifications = notifications.filter((n) => String(n.userId || '') === String(req.user.userId));

    const base = {
      departments: { total: isAdmin ? countBy(departments) : countBy(departments.filter((d) => String(d.departmentId) === String(departmentId))) },
      students: { total: countBy(dStudents), active: countBy(dStudents.filter((s) => String(s.status || 'active') === 'active')) },
      faculty: { total: countBy(dFaculty) },
      hods: { total: countBy(dHods) },
      subjects: { total: countBy(dSubjects), active: countBy(dSubjects.filter((s) => String(s.status || 'active') === 'active')) },
      allocations: { total: countBy(dAllocations), active: countBy(dAllocations.filter((a) => String(a.status || 'active').toLowerCase() === 'active')) },
      attendance: { records: countBy(dAttendance), sessions: new Set(dAttendance.map((a) => `${a.date}|${a.subjectCode}|${a.departmentId}`)).size },
      materials: { total: countBy(dMaterials) },
      assignments: { total: countBy(dAssignments) },
      marks: { total: countBy(dMarks) },
      timetable: { total: countBy(dTimetable) },
      exams: { total: countBy(dExams), upcoming: countBy(dExams.filter((e) => String(e.date) >= new Date().toISOString().slice(0, 10))) },
      announcements: { total: countBy(dAnnouncements) },
      notifications: { total: countBy(dNotifications), unread: countBy(dNotifications.filter((n) => !toBool(n.isRead))) },
    };

    

    if (isAdmin) {
      const allUsers = await dataService.users();
      base.system = {
        totalUsers: allUsers.length,
        activeUsers: allUsers.filter((u) => String(u.status || 'active').toLowerCase() === 'active').length,
        scope: SINGLE_DEPARTMENT.departmentName,
      };
    }

    const present = dAttendance.filter((a) => String(a.status).toLowerCase() === 'present').length;
    base.attendance.present = present;
    base.attendance.absent = dAttendance.length - present;
    base.attendance.percentage = dAttendance.length ? Number(((present / dAttendance.length) * 100).toFixed(2)) : 0;

    // Subject allocation coverage, so an HOD sees at a glance whether every
    // subject has a teacher. Keyed by semester + subject code, exactly as the
    // allocation table is validated.
    if (role === 'hod' || role === 'admin') {
      const subjectKey = (s) => `${Number(s.semester)}|${String(s.subjectCode || '').toUpperCase()}`;
      const allocatedKeys = new Set(
        dAllocations
          .filter((a) => String(a.status || 'active').toLowerCase() === 'active')
          .map(subjectKey)
      );
      const activeSubjects = dSubjects.filter((s) => String(s.status || 'active').toLowerCase() === 'active');
      const unallocatedSubjects = activeSubjects.filter((s) => !allocatedKeys.has(subjectKey(s)));
      base.allocations.unallocatedSubjects = unallocatedSubjects.length;
      base.allocations.coverage = activeSubjects.length
        ? Number((((activeSubjects.length - unallocatedSubjects.length) / activeSubjects.length) * 100).toFixed(2))
        : 0;
    }

    // ------------------------------------------------------ student dashboard
    if (role === 'student') {
      const me = students.find((s) => String(s.email || '').toLowerCase() === String(req.user.email).toLowerCase());
      if (!me) return res.json({ success: true, message: 'Operation successful', data: { role, profile: null, empty: true } });
      const registerNumber = String(me.registerNumber).toUpperCase();
      const myAttendance = dAttendance.filter((a) => String(a.registerNumber).toUpperCase() === registerNumber);
      const myPresent = myAttendance.filter((a) => String(a.status).toLowerCase() === 'present').length;
      const bySubject = new Map();
      myAttendance.forEach((a) => {
        const key = `${a.subjectCode}|${a.semester}`;
        if (!bySubject.has(key)) {
          bySubject.set(key, { subjectCode: a.subjectCode, subjectName: a.subjectName, semester: Number(a.semester) || 0, totalClasses: 0, present: 0, absent: 0 });
        }
        const e = bySubject.get(key);
        e.totalClasses += 1;
        if (String(a.status).toLowerCase() === 'present') e.present += 1;
        else e.absent += 1;
      });
      const myMarks = dMarks.filter((m) => String(m.registerNumber).toUpperCase() === registerNumber).map(withTotals);
      const myAssignments = dAssignments
        .filter((a) => Number(a.semester) === Number(me.semester))
        .map((a) => ({ ...a, status: computeAssignmentStatus(a) }));
      const myAnnouncements = dAnnouncements
        .filter((a) => ['all', 'student'].includes(String(a.targetRole || 'all').toLowerCase()))
        .filter((a) => !a.departmentId || String(a.departmentId) === String(departmentId))
        .sort((x, y) => String(y.publishDate).localeCompare(String(x.publishDate)));
      return res.json({
        success: true,
        message: 'Operation successful',
        data: {
          role,
          profile: {
            name: me.name,
            registerNumber: me.registerNumber,
            semester: Number(me.semester),
            departmentName: me.departmentName || '',
            email: me.email,
            batch: me.batch || '',
          },
          attendance: {
            totalClasses: myAttendance.length,
            present: myPresent,
            absent: myAttendance.length - myPresent,
            percentage: myAttendance.length ? Number(((myPresent / myAttendance.length) * 100).toFixed(2)) : 0,
            subjects: [...bySubject.values()]
              .map((s) => ({ ...s, percentage: s.totalClasses ? Number(((s.present / s.totalClasses) * 100).toFixed(2)) : 0 }))
              .sort((a, b) => a.semester - b.semester || a.subjectCode.localeCompare(b.subjectCode)),
          },
          subjects: { total: countBy(subjects.filter((s) => String(s.departmentId || '') === String(departmentId) && Number(s.semester) === Number(me.semester))) },
          assignments: {
            total: countBy(myAssignments),
            pending: countBy(myAssignments.filter((a) => a.status === 'pending')),
            submitted: countBy(myAssignments.filter((a) => a.status === 'submitted' || a.status === 'completed')),
            overdue: countBy(myAssignments.filter((a) => a.status === 'overdue')),
          },
          materials: { total: countBy(dMaterials.filter((m) => Number(m.semester) === Number(me.semester))) },
          marks: {
            total: countBy(myMarks),
            averagePercentage: myMarks.length ? Number((myMarks.reduce((sum, m) => sum + m.percentage, 0) / myMarks.length).toFixed(2)) : 0,
            scale: MARKS_MAX,
          },
          exams: { total: countBy(dExams.filter((e) => Number(e.semester) === Number(me.semester))) },
          timetable: { total: countBy(dTimetable.filter((t) => Number(t.semester) === Number(me.semester))) },
          announcements: { total: countBy(myAnnouncements), latest: myAnnouncements.slice(0, 5) },
          notifications: { unread: countBy(dNotifications.filter((n) => !toBool(n.isRead))), total: countBy(dNotifications) },
        },
      });
    }

    // ---------------------------------------------------- faculty / HOD / admin
    const recentAttendance = [...dAttendance]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 8);

    const payload = {
      role,
      department: isAdmin
        ? {
            // Single-department deployment: the admin scope is that one department.
            allDepartments: false,
            departmentId: SINGLE_DEPARTMENT.departmentId,
            departmentName: SINGLE_DEPARTMENT.departmentName,
            total: countBy(departments),
          }
        : {
            departmentId: departmentId || '',
            departmentName: (departments.find((d) => String(d.departmentId) === String(departmentId)) || {}).departmentName || req.user.departmentName || '',
          },
      ...base,
      marksAverage: dMarks.length
        ? Number((dMarks.map(withTotals).reduce((s, m) => s + m.percentage, 0) / dMarks.length).toFixed(2))
        : 0,
      recentAttendance,
      recentAnnouncements: [...dAnnouncements]
        .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)))
        .slice(0, 5),
      departmentsBreakdown: isAdmin
        ? departments.map((d) => ({
            departmentId: d.departmentId,
            departmentName: d.departmentName,
            departmentCode: d.departmentCode,
            students: countBy(students.filter((s) => String(s.departmentId || '') === String(d.departmentId))),
            faculty: countBy(faculty.filter((f) => String(f.departmentId || '') === String(d.departmentId))),
            subjects: countBy(subjects.filter((s) => String(s.departmentId || '') === String(d.departmentId))),
          }))
        : [],
      topStudents: isAdmin
        ? students.filter((s) => String(s.status || 'active') === 'active').sort(byRegisterNumber).slice(0, 10)
        : dStudents.filter((s) => String(s.status || 'active') === 'active').sort(byRegisterNumber).slice(0, 10),
      // Non-empty only when the deployment is missing modules; the UI can warn.
      unavailableModules: unavailable,
    };
    return res.json({ success: true, message: 'Operation successful', data: payload });
  })
);

/**
 * GET /api/dashboard/control-center
 * HOD Department Control Center.
 *
 * Answers the three questions an HOD actually has: which subjects still have no
 * teacher, how the teaching load is spread across faculty, and which students are
 * at risk. Everything is derived from the real sheet rows and scoped to the HOD's
 * own department on the server.
 */
router.get(
  '/control-center',
  requireRole('hod', 'admin'),
  asyncHandler(async (req, res) => {
    const unavailable = [];
    const departmentId = req.user.role === 'admin' ? String(req.query.departmentId || '') : String(req.user.departmentId || '');
    if (req.user.role !== 'admin' && !departmentId) {
      return res.status(403).json({ success: false, message: 'No department is assigned to your account.' });
    }

    const [departments, subjects, allocations, faculty, students, attendance, assignments, materials] =
      await Promise.all([
        load('departments', () => dataService.departments(), unavailable),
        load('subjects', () => dataService.subjects(), unavailable),
        load('SubjectAllocations', () => dataService.subjectAllocations(), unavailable),
        load('faculty', () => dataService.faculty(), unavailable),
        load('students', () => dataService.students(), unavailable),
        load('attendance', () => dataService.attendance(), unavailable),
        load('assignments', () => dataService.assignments(), unavailable),
        load('materials', () => dataService.materials(), unavailable),
      ]);

    const inDept = (row) => !departmentId || String(row.departmentId || '') === departmentId;
    const semesterFilter = req.query.semester ? Number(req.query.semester) : null;
    const code = (v) => String(v || '').toUpperCase();

    const department = departments.find((d) => String(d.departmentId) === departmentId) || null;
    const dSubjects = subjects.filter(inDept).filter((s) => (semesterFilter ? Number(s.semester) === semesterFilter : true));
    const dAllocations = allocations
      .filter(inDept)
      .filter((a) => String(a.status || 'active').toLowerCase() === 'active')
      .filter((a) => (semesterFilter ? Number(a.semester) === semesterFilter : true));
    const dFaculty = faculty.filter(inDept);
    const dStudents = students.filter(inDept);
    const dAttendance = attendance.filter(inDept);

    const facultyById = new Map(dFaculty.map((f) => [String(f.facultyId || ''), f]));
    const studentByRegister = new Map(dStudents.map((s) => [String(s.registerNumber || '').toUpperCase(), s]));
    const studentsPerSemester = new Map();
    dStudents.forEach((s) => studentsPerSemester.set(Number(s.semester), (studentsPerSemester.get(Number(s.semester)) || 0) + 1));

    // One row per subject, showing whether it has a teacher and who.
    const allocationByKey = new Map(dAllocations.map((a) => [`${Number(a.semester)}|${code(a.subjectCode)}`, a]));
    const subjectRows = dSubjects
      .map((s) => {
        const key = `${Number(s.semester)}|${code(s.subjectCode)}`;
        const allocation = allocationByKey.get(key) || null;
        const facultyRow = allocation ? facultyById.get(String(allocation.facultyId || '')) : null;
        return {
          subjectCode: code(s.subjectCode),
          subjectName: s.subjectName || '',
          semester: Number(s.semester),
          credits: Number(s.credits || 0),
          subjectId: s.subjectId || '',
          status: s.status || 'active',
          allocated: Boolean(allocation),
          allocationId: allocation ? allocation.allocationId : '',
          facultyId: allocation ? allocation.facultyId || '' : '',
          // Prefer the live Faculty row so a renamed teacher is not stale.
          facultyName: facultyRow ? facultyRow.name : allocation ? allocation.facultyName || '' : '',
          facultyDesignation: facultyRow ? facultyRow.designation || '' : '',
          assignedDate: allocation ? allocation.assignedDate || '' : '',
          studentCount: studentsPerSemester.get(Number(s.semester)) || 0,
        };
      })
      .sort((a, b) => a.semester - b.semester || code(a.subjectCode).localeCompare(code(b.subjectCode)));

    const unallocated = subjectRows.filter((s) => !s.allocated);

    // Teaching load per faculty member.
    const workload = dFaculty
      .map((f) => {
        const mine = dAllocations.filter((a) => String(a.facultyId || '') === String(f.facultyId || ''));
        const semesters = [...new Set(mine.map((a) => Number(a.semester)))].filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
        const totalCredits = mine.reduce((sum, a) => {
          const s = dSubjects.find((x) => code(x.subjectCode) === code(a.subjectCode) && Number(x.semester) === Number(a.semester));
          return sum + Number((s && s.credits) || 0);
        }, 0);
        return {
          facultyId: f.facultyId || '',
          employeeId: f.employeeId || '',
          name: f.name || '',
          email: f.email || '',
          designation: f.designation || '',
          status: f.status || 'active',
          subjects: mine.length,
          credits: totalCredits,
          semesters,
          studentCount: semesters.reduce((sum, n) => sum + (studentsPerSemester.get(n) || 0), 0),
          subjectCodes: mine
            .map((a) => `${code(a.subjectCode)} (Sem ${Number(a.semester)})`)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        };
      })
      .sort((a, b) => b.subjects - a.subjects || String(a.name).localeCompare(String(b.name)));

    // Attendance per student, with a 75% threshold flagging who needs attention.
    const perStudent = new Map();
    dAttendance.forEach((a) => {
      const key = String(a.registerNumber || '').toUpperCase();
      if (!key) return;
      if (!perStudent.has(key)) perStudent.set(key, { total: 0, present: 0 });
      const entry = perStudent.get(key);
      entry.total += 1;
      if (String(a.status || '').toLowerCase() === 'present') entry.present += 1;
    });
    const atRisk = [...perStudent.entries()]
      .map(([registerNumber, entry]) => {
        const student = studentByRegister.get(registerNumber);
        if (!student) return null;
        const percentage = entry.total ? Number(((entry.present / entry.total) * 100).toFixed(2)) : 0;
        return {
          studentId: student.studentId || '',
          registerNumber: student.registerNumber || registerNumber,
          name: student.name || '',
          semester: Number(student.semester),
          batch: student.batch || '',
          totalClasses: entry.total,
          present: entry.present,
          absent: entry.total - entry.present,
          percentage,
          belowThreshold: percentage < 75,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.percentage - b.percentage || byRegisterNumber(a, b));

    const recentAllocations = [...allocations]
      .filter(inDept)
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .slice(0, 8)
      .map((a) => ({
        allocationId: a.allocationId || '',
        semester: Number(a.semester),
        subjectCode: code(a.subjectCode),
        subjectName: a.subjectName || '',
        facultyId: a.facultyId || '',
        facultyName: (facultyById.get(String(a.facultyId || '')) || {}).name || a.facultyName || '',
        status: a.status || 'active',
        assignedDate: a.assignedDate || '',
        assignedBy: a.assignedBy || '',
        updatedAt: a.updatedAt || a.createdAt || '',
      }));

    return res.json({
      success: true,
      message: 'Operation successful',
      data: {
        department: department
          ? { departmentId: department.departmentId, departmentCode: department.departmentCode, departmentName: department.departmentName }
          : { departmentId, departmentName: req.user.departmentName || '' },
        semester: semesterFilter,
        totals: {
          subjects: subjectRows.length,
          allocatedSubjects: subjectRows.length - unallocated.length,
          unallocatedSubjects: unallocated.length,
          allocationCoverage: subjectRows.length
            ? Number((((subjectRows.length - unallocated.length) / subjectRows.length) * 100).toFixed(2))
            : 0,
          faculty: dFaculty.length,
          students: dStudents.length,
          atRiskStudents: atRisk.filter((s) => s.belowThreshold).length,
          assignments: assignments.filter(inDept).length,
          materials: materials.filter(inDept).length,
        },
        subjects: subjectRows,
        unallocated,
        workload,
        atRiskStudents: atRisk.filter((s) => s.belowThreshold).slice(0, 25),
        recentAllocations,
        semesters: [...new Set(subjects.filter(inDept).map((s) => Number(s.semester)))]
          .filter((n) => !Number.isNaN(n))
          .sort((a, b) => a - b),
        hasAllocationsTable: !unavailable.includes('SubjectAllocations'),
        unavailableModules: unavailable,
      },
    });
  })
);

module.exports = router;