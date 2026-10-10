const router = require('express').Router();
const appsScript = require('../services/appsScriptClient');
const dataService = require('../services/dataService');
const { requireRole, actorOf } = require('../middleware/auth');
const { asyncHandler, badRequest, forbidden, notFound } = require('../middleware/error');
const { validate, SPECS, currentIstParts, isPastCutoff, cutoffMessage } = require('../utils/validate');
const { byRegisterNumber } = require('../utils/naturalSort');
const { resolveFacultyRow, allocationsFor, assertCanWriteForSubject } = require('../utils/facultyScope');

const VALID_STATUS = ['present', 'absent'];

const isSameDepartment = (user, row) => String(row.departmentId || '') === String(user.departmentId || '');

/** Student attendance register for one session — department scoped, register-number ordered. */
const buildSummary = (rows, registerNumber) => {
  const map = new Map();
  rows
    .filter((r) => String(r.registerNumber || '').toUpperCase() === registerNumber)
    .forEach((r) => {
      const key = `${r.subjectCode}__${Number(r.semester) || 0}`;
      if (!map.has(key)) {
        map.set(key, {
          subjectCode: r.subjectCode,
          subjectName: r.subjectName,
          semester: Number(r.semester) || 0,
          departmentId: r.departmentId,
          departmentName: r.departmentName,
          totalClasses: 0,
          present: 0,
          absent: 0,
          attendancePercentage: 0,
          lastMarkedDate: '',
        });
      }
      const entry = map.get(key);
      entry.totalClasses += 1;
      if (String(r.status).toLowerCase() === 'present') entry.present += 1;
      else entry.absent += 1;
      if (!entry.lastMarkedDate || String(r.date) > entry.lastMarkedDate) entry.lastMarkedDate = String(r.date);
    });
  return [...map.values()]
    .map((e) => ({
      ...e,
      attendancePercentage: e.totalClasses ? Number(((e.present / e.totalClasses) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => a.semester - b.semester || a.subjectCode.localeCompare(b.subjectCode));
};

// ---------------------------------------------------------------------- GET
/** Resolves the authenticated student's own register number (never from the client). */
const resolveOwnRegisterNumber = async (req) => {
  const students = await dataService.students();
  const me = students.find((s) => String(s.email || '').toLowerCase() === String(req.user.email).toLowerCase());
  if (!me) throw notFound('Student record not found for this account');
  return String(me.registerNumber).toUpperCase();
};

// Student: own summary only.
router.get(
  '/summary',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const registerNumber = await resolveOwnRegisterNumber(req);
    const all = await dataService.attendance();
    const mine = all.filter((r) => String(r.registerNumber || '').toUpperCase() === registerNumber);
    return res.json({ success: true, message: 'Operation successful', data: buildSummary(mine, registerNumber) });
  })
);

// Student: own raw attendance history (cannot be widened by query parameters).
router.get(
  '/me',
  requireRole('student'),
  asyncHandler(async (req, res) => {
    const registerNumber = await resolveOwnRegisterNumber(req);
    let rows = (await dataService.attendance()).filter(
      (r) => String(r.registerNumber || '').toUpperCase() === registerNumber
    );
    if (req.query.semester) rows = rows.filter((r) => Number(r.semester) === Number(req.query.semester));
    if (req.query.subjectCode) rows = rows.filter((r) => String(r.subjectCode).toUpperCase() === String(req.query.subjectCode).toUpperCase());
    if (req.query.status) rows = rows.filter((r) => String(r.status).toLowerCase() === String(req.query.status).toLowerCase());
    const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return res.json({ success: true, message: 'Operation successful', data: sorted });
  })
);

// Faculty / HOD / Admin: filterable attendance history (department scope applied server-side).
router.get(
  '/',
  requireRole('faculty', 'hod', 'admin'),
  asyncHandler(async (req, res) => {
    const { date, startDate, endDate, semester, subjectCode, registerNumber, status } = req.query;
    let rows = await dataService.attendance();
    rows = rows.filter((r) => (req.user.role === 'admin' ? true : isSameDepartment(req.user, r)));
    if (req.query.departmentId) rows = rows.filter((r) => String(r.departmentId) === String(req.query.departmentId));
    if (date) rows = rows.filter((r) => String(r.date) === String(date));
    if (startDate) rows = rows.filter((r) => String(r.date) >= String(startDate));
    if (endDate) rows = rows.filter((r) => String(r.date) <= String(endDate));
    if (semester) rows = rows.filter((r) => Number(r.semester) === Number(semester));
    if (subjectCode) rows = rows.filter((r) => String(r.subjectCode).toUpperCase() === String(subjectCode).toUpperCase());
    if (registerNumber) rows = rows.filter((r) => String(r.registerNumber).toUpperCase() === String(registerNumber).toUpperCase());
    if (status) rows = rows.filter((r) => String(r.status).toLowerCase() === String(status).toLowerCase());
    if (req.query.search) {
      rows = rows.filter((r) => dataService.matchesSearch(r, req.query.search, ['registerNumber', 'studentName', 'subjectCode', 'subjectName', 'facultyName']));
    }
    const sorted = [...rows].sort((a, b) => {
      const cmp = String(b.date).localeCompare(String(a.date));
      return cmp !== 0 ? cmp : byRegisterNumber(a, b);
    });
    const { rows: pageRows, pagination } = dataService.paginate(sorted, req.query.page, req.query.limit);
    return res.json({ success: true, message: 'Operation successful', data: pageRows, pagination });
  })
);

// Roster for marking one session: authorized department students, register-number ascending.
router.get(
  '/roster',
  requireRole('faculty', 'hod', 'admin'),
  asyncHandler(async (req, res) => {
    const { semester, subjectCode, date } = req.query;
    const { errors, data } = validate({ semester, subjectCode }, SPECS.attendance);
    if (Object.keys(errors).length) throw badRequest('Select a valid semester and subject.', errors);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw badRequest('Select a valid date.', { date: 'Use YYYY-MM-DD' });

    const students = await dataService.students();
    const subjects = await dataService.subjects();
    const subject = subjects.find(
      (s) =>
        String(s.subjectCode).toUpperCase() === data.subjectCode &&
        Number(s.semester) === Number(data.semester) &&
        (req.user.role === 'admin' ? String(s.departmentId || '') === String(req.query.departmentId || s.departmentId || '') : String(s.departmentId || '') === String(req.user.departmentId || ''))
    );
    if (!subject) throw notFound('Subject not found in your department for the selected semester');

    // A faculty member may only open the register for a subject allocated to them.
    if (req.user.role === 'faculty') {
      const me = await resolveFacultyRow(req.user);
      const mine = me ? await allocationsFor(me.facultyId) : [];
      const allocated = mine.some(
        (a) =>
          String(a.subjectCode || '').toUpperCase() === data.subjectCode &&
          Number(a.semester) === Number(data.semester)
      );
      if (!allocated) {
        throw forbidden('You are not allocated to that subject for this semester. Ask your HOD to allocate it first.');
      }
    }

    const scopedStudents = students
      .filter((s) => String(s.departmentId || '') === String(subject.departmentId || ''))
      .filter((s) => Number(s.semester) === Number(data.semester))
      .filter((s) => String(s.status || 'active').toLowerCase() === 'active')
      .sort(byRegisterNumber);

    const existing = (await dataService.attendance()).filter(
      (r) =>
        String(r.date) === String(date) &&
        String(r.subjectCode).toUpperCase() === data.subjectCode &&
        Number(r.semester) === Number(data.semester) &&
        String(r.departmentId || '') === String(subject.departmentId || '')
    );

    const alreadySubmitted = existing.length > 0;
    const closed = isPastCutoff();

    return res.json({
      success: true,
      message: 'Operation successful',
      data: {
        subject: {
          subjectId: subject.subjectId,
          subjectCode: subject.subjectCode,
          subjectName: subject.subjectName,
          semester: Number(subject.semester),
          credits: Number(subject.credits || 0),
          departmentId: subject.departmentId,
          departmentName: subject.departmentName,
        },
        date: String(date),
        submissionClosed: closed,
        cutoffMessage: closed ? cutoffMessage : '',
        alreadySubmitted,
        serverTimeIst: currentIstParts(),
        students: scopedStudents.map((s) => {
          const saved = existing.find((r) => String(r.registerNumber).toUpperCase() === String(s.registerNumber).toUpperCase());
          return {
            registerNumber: s.registerNumber,
            name: s.name,
            status: saved ? String(saved.status).toLowerCase() : '',
            attendanceId: saved ? saved.attendanceId : '',
          };
        }),
      },
    });
  })
);

// ---------------------------------------------------------------------- POST
router.post(
  '/',
  requireRole('faculty', 'hod', 'admin'),
  asyncHandler(async (req, res) => {
    const override = String(req.body.overrideCutoff || '') === 'true';
    if (isPastCutoff() && !override) return res.status(403).json({ success: false, message: cutoffMessage });
    if (override && req.user.role === 'faculty') return res.status(403).json({ success: false, message: cutoffMessage });

    // Reopening an already-submitted session is an audited override, so it must
    // carry a written reason just like the single-record correction endpoints.
    const overrideReason = String(req.body.reason || '').trim();
    if (override && overrideReason.length < 3) {
      throw badRequest('A reason is required to reopen submitted attendance.', { reason: 'Enter a reason' });
    }

    const { errors, data } = validate(req.body, SPECS.attendance);
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);

    const entries = Array.isArray(req.body.students) ? req.body.students : [];
    if (!entries.length) throw badRequest('No students were submitted.', { students: 'At least one student is required' });
    const invalid = entries.find((e) => !VALID_STATUS.includes(String(e.status || '').toLowerCase()));
    if (invalid) throw badRequest('Every student must be marked Present or Absent.', { students: 'Incomplete attendance' });

    const subjects = await dataService.subjects();
    const subject = subjects.find(
      (s) =>
        String(s.subjectCode).toUpperCase() === data.subjectCode &&
        Number(s.semester) === Number(data.semester) &&
        (req.user.role === 'admin'
          ? !req.body.departmentId || String(s.departmentId || '') === String(req.body.departmentId)
          : String(s.departmentId || '') === String(req.user.departmentId || ''))
    );
    if (!subject) throw forbidden('Subject not found in your department for the selected semester.');
    const departmentId = subject.departmentId;

    // A faculty member may only submit a register for a subject allocated to them,
    // and the row must be stamped with their Faculty id (not their login userId)
    // so it links to subject allocations and materials.
    let markingFaculty = null;
    if (req.user.role === 'faculty') {
      await assertCanWriteForSubject(req.user, data.subjectCode, data.semester, departmentId);
      markingFaculty = await resolveFacultyRow(req.user);
    }

    const students = (await dataService.students())
      .filter((s) => String(s.departmentId || '') === String(departmentId) && Number(s.semester) === Number(data.semester))
      .sort(byRegisterNumber);
    const known = new Set(students.map((s) => String(s.registerNumber).toUpperCase()));

    const unauthorized = entries.find((e) => !known.has(String(e.registerNumber || '').toUpperCase()));
    if (unauthorized) throw forbidden('One or more students do not belong to your department/semester.');

    const existing = await dataService.attendance();
    const duplicates = entries.filter((e) =>
      existing.some(
        (r) =>
          String(r.date) === data.date &&
          String(r.subjectCode).toUpperCase() === data.subjectCode &&
          String(r.registerNumber).toUpperCase() === String(e.registerNumber).toUpperCase() &&
          String(r.departmentId || '') === String(departmentId)
      )
    );
    if (duplicates.length && !override) {
      throw badRequest(
        `Attendance for ${duplicates.length} student(s) already exists for ${data.subjectCode} on ${data.date}. Use "Reopen & update" if you need to correct it.`,
        { date: 'Already submitted' }
      );
    }

    const records = entries
      .filter((e) => known.has(String(e.registerNumber || '').toUpperCase()))
      .sort((a, b) => byRegisterNumber({ registerNumber: a.registerNumber }, { registerNumber: b.registerNumber }))
      .map((e) => {
        const student = students.find((s) => String(s.registerNumber).toUpperCase() === String(e.registerNumber).toUpperCase());
        return {
          date: data.date,
          registerNumber: student.registerNumber,
          studentName: student.name,
          studentId: student.studentId || '',
          subjectCode: subject.subjectCode,
          subjectName: subject.subjectName,
          semester: Number(subject.semester),
          departmentId,
          departmentName: subject.departmentName || '',
          status: String(e.status).toLowerCase(),
          facultyId: markingFaculty ? markingFaculty.facultyId : '',
          facultyName: markingFaculty ? markingFaculty.name : req.user.name,
          markedById: req.user.userId,
          updatedBy: req.user.userId,
          updatedByRole: req.user.role,
        };
      });

    const result = await appsScript.post('save_attendance', { records, override }, actorOf(req));
    await appsScript.post('audit_log', {
      record: {
        action: override ? 'reopen_update' : 'create',
        resource: 'Attendance',
        recordId: `${subject.subjectCode}-${data.date}-${departmentId}`,
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId,
        detail: override
          ? `Reopened attendance for ${subject.subjectCode} on ${data.date}. Reason: ${overrideReason}`
          : `Submitted attendance for ${subject.subjectCode} on ${data.date} (${records.length} students)`,
      },
    });

    // Notify each affected student with their own result.
    const notifications = records.map((r) => ({
      userId: r.studentId || r.registerNumber,
      title: `Attendance marked - ${r.subjectCode}`,
      message: `Your attendance for ${r.subjectName} on ${r.date} was marked as ${r.status === 'present' ? 'Present' : 'Absent'}.`,
      type: r.status === 'present' ? 'success' : 'warning',
    }));
    if (notifications.length) await appsScript.post('create_notifications', { records: notifications });

    return res.status(201).json({ success: true, message: `Attendance saved for ${records.length} student(s)`, data: result.data || records });
  })
);

// ---------------------------------------------------------------------- PUT (reopen / correct one record)
router.put(
  '/:id',
  requireRole('hod', 'admin'),
  asyncHandler(async (req, res) => {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3) throw badRequest('A reason is required when reopening attendance.', { reason: 'Enter a reason' });
    const status = String(req.body.status || '').toLowerCase();
    if (!VALID_STATUS.includes(status)) throw badRequest('Status must be Present or Absent.', { status: 'Invalid status' });

    const rows = await dataService.attendance();
    const row = rows.find((r) => String(r.attendanceId || '') === String(req.params.id));
    if (!row) throw notFound('Attendance record not found');
    if (req.user.role !== 'admin' && !isSameDepartment(req.user, row)) throw forbidden('You cannot modify attendance outside your department.');

    const result = await appsScript.post('update_attendance', {
      id: String(req.params.id),
      record: { status, updatedBy: req.user.userId, updatedByRole: req.user.role },
    }, actorOf(req));
    await appsScript.post('audit_log', {
      record: {
        action: 'reopen_update',
        resource: 'Attendance',
        recordId: String(row.attendanceId),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: row.departmentId,
        detail: `Status changed from ${row.status} to ${status}. Reason: ${reason}`,
      },
    });
    const students = await dataService.students();
    const student = students.find((s) => String(s.registerNumber).toUpperCase() === String(row.registerNumber).toUpperCase());
    if (student) {
      await appsScript.post('create_notifications', {
        records: [
          {
            userId: student.studentId || row.registerNumber,
            title: `Attendance updated - ${row.subjectCode}`,
            message: `Your attendance for ${row.subjectName} on ${row.date} was updated to ${status}. Reason: ${reason}`,
            type: 'info',
          },
        ],
      });
    }
    return res.json({ success: true, message: 'Attendance record updated', data: result.data });
  })
);

// ---------------------------------------------------------------------- DELETE (HOD / Admin only, audited)
router.delete(
  '/:id',
  requireRole('hod', 'admin'),
  asyncHandler(async (req, res) => {
    const reason = String(req.body && req.body.reason ? req.body.reason : '').trim();
    if (reason.length < 3) throw badRequest('A reason is required to remove an attendance record.', { reason: 'Enter a reason' });
    const rows = await dataService.attendance();
    const row = rows.find((r) => String(r.attendanceId || '') === String(req.params.id));
    if (!row) throw notFound('Attendance record not found');
    if (req.user.role !== 'admin' && !isSameDepartment(req.user, row)) throw forbidden('You cannot remove attendance outside your department.');

    const result = await appsScript.post('delete_attendance', { id: String(req.params.id) }, actorOf(req));
    await appsScript.post('audit_log', {
      record: {
        action: 'delete',
        resource: 'Attendance',
        recordId: String(row.attendanceId),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: row.departmentId,
        detail: `Removed attendance for ${row.registerNumber} (${row.subjectCode}, ${row.date}). Reason: ${reason}`,
      },
    });
    return res.json({ success: true, message: 'Attendance record removed', data: result.data });
  })
);

module.exports = router;