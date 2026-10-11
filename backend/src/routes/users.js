const router = require('express').Router();
const appsScript = require('../services/appsScriptClient');
const dataService = require('../services/dataService');
const { requireRole } = require('../middleware/auth');
const { asyncHandler, badRequest, forbidden, notFound } = require('../middleware/error');
const { validate, SPECS } = require('../utils/validate');
const { byRegisterNumber, naturalCompare } = require('../utils/naturalSort');
const { hashPassword } = require('../services/crudFactory');
const { SINGLE_DEPARTMENT } = require('../config/department');

/** Password hashes are never returned to the client. */
const safeUser = (u) => ({
  userId: u.userId,
  name: u.name,
  email: u.email,
  role: u.role,
  departmentId: u.departmentId || '',
  departmentName: u.departmentName || '',
  status: u.status || 'active',
  createdAt: u.createdAt || '',
  lastLoginAt: u.lastLoginAt || '',
});

router.get(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const users = await dataService.users();
    const term = req.query.search ? String(req.query.search) : '';
    const role = req.query.role ? String(req.query.role).toLowerCase() : '';
    const status = req.query.status ? String(req.query.status).toLowerCase() : '';
    const departmentId = req.query.departmentId ? String(req.query.departmentId) : '';
    let rows = users
      .filter((u) => dataService.matchesSearch(u, term, ['name', 'email', 'userId', 'departmentName']))
      .filter((u) => (role ? String(u.role).toLowerCase() === role : true))
      .filter((u) => (status ? String(u.status || 'active').toLowerCase() === status : true))
      .filter((u) => (departmentId ? String(u.departmentId || '') === departmentId : true));
    if (req.query.global === 'true') rows = users.filter((u) => dataService.matchesSearch(u, term, ['name', 'email', 'userId', 'departmentName', 'role']));
    const sorted = [...rows].sort((a, b) => naturalCompare(a.name || '', b.name || ''));
    const { rows: pageRows, pagination } = dataService.paginate(sorted, req.query.page, req.query.limit);
    return res.json({ success: true, message: 'Operation successful', data: pageRows.map(safeUser), pagination });
  })
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { errors, data } = validate(req.body, SPECS.adminUser);
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);

    // Single-department deployment: a non-admin always belongs to the one
    // department, and an admin belongs to none. A client-supplied department is
    // never trusted.
    if (data.role !== 'admin') {
      data.departmentId = SINGLE_DEPARTMENT.departmentId;
      data.departmentName = SINGLE_DEPARTMENT.departmentName;
    } else {
      data.departmentId = '';
      data.departmentName = '';
    }

    const users = await dataService.users();
    if (users.some((u) => String(u.email || '').toLowerCase() === data.email)) {
      throw badRequest('An account with this email already exists.', { email: 'Already in use' });
    }
    const passwordHash = await hashPassword(data.password);
    delete data.password;
    const record = { ...data };
    const result = await appsScript.post('create_user', { record, passwordHash });
    await appsScript.post('audit_log', {
      record: {
        action: 'create',
        resource: 'User',
        recordId: (result.data && result.data.userId) || data.email,
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: data.departmentId || '',
        detail: `${data.role} account created for ${data.email}`,
      },
    });
    return res.status(201).json({ success: true, message: 'User created successfully', data: result.data ? safeUser(result.data) : { ...record, passwordHash: undefined } });
  })
);

router.put(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const users = await dataService.users();
    const row = users.find((u) => String(u.userId || '') === String(req.params.id));
    if (!row) throw notFound('User not found');

    const payload = {};
    if (req.body.name !== undefined) payload.name = String(req.body.name).trim();
    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!SPECS.adminUser.email.check(email)) throw badRequest('Enter a valid email address.', { email: 'Invalid email' });
      if (users.some((u) => String(u.userId) !== String(req.params.id) && String(u.email || '').toLowerCase() === email)) {
        throw badRequest('An account with this email already exists.', { email: 'Already in use' });
      }
      payload.email = email;
    }
    if (req.body.status !== undefined) {
      if (!['active', 'inactive'].includes(String(req.body.status).toLowerCase())) throw badRequest('Invalid status.');
      if (String(row.userId) === String(req.user.userId) && String(req.body.status).toLowerCase() !== 'active') {
        throw badRequest('You cannot deactivate your own account.');
      }
      payload.status = String(req.body.status).toLowerCase();
    }
    if (req.body.password) {
      if (String(req.body.password).length < 8) throw badRequest('Password must be at least 8 characters.', { password: 'Too short' });
      payload.passwordHash = await hashPassword(req.body.password);
    }
    if (!Object.keys(payload).length) throw badRequest('Nothing to update.');

    const result = await appsScript.post('update_user', { id: String(req.params.id), record: payload });
    await appsScript.post('audit_log', {
      record: {
        action: 'update',
        resource: 'User',
        recordId: String(req.params.id),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: row.departmentId || '',
        detail: `Updated fields: ${Object.keys(payload).filter((k) => k !== 'passwordHash').join(', ') || 'password'}`,
      },
    });
    return res.json({ success: true, message: 'User updated successfully', data: result.data ? safeUser(result.data) : safeUser({ ...row, ...payload }) });
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const users = await dataService.users();
    const row = users.find((u) => String(u.userId || '') === String(req.params.id));
    if (!row) throw notFound('User not found');
    if (String(row.userId) === String(req.user.userId)) throw badRequest('You cannot remove your own account.');
    if (['admin'].includes(String(row.role).toLowerCase())) {
      const admins = users.filter((u) => String(u.role).toLowerCase() === 'admin' && String(u.status || 'active').toLowerCase() === 'active');
      if (admins.length <= 1) throw badRequest('At least one active administrator account must remain.');
    }
    // Accounts referenced by academic records are deactivated, never destroyed.
    const [attendance, marks, notifications] = await Promise.all([
      dataService.attendance(),
      dataService.marks(),
      dataService.notifications(),
    ]);
    const referenced =
      attendance.some((a) => String(a.studentId || '') === String(row.userId) || String(a.facultyId || '') === String(row.userId)) ||
      marks.some((m) => String(m.studentId || '') === String(row.userId)) ||
      notifications.some((n) => String(n.userId || '') === String(row.userId));

    if (referenced) {
      await appsScript.post('update_user', { id: String(req.params.id), record: { status: 'inactive' } });
      await appsScript.post('audit_log', {
        record: {
          action: 'update',
          resource: 'User',
          recordId: String(req.params.id),
          performedBy: req.user.userId,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          departmentId: row.departmentId || '',
          detail: 'deactivated because the account is referenced by academic records',
        },
      });
      return res.json({
        success: true,
        message: 'This account is linked to academic records and cannot be deleted. It has been deactivated instead.',
        deactivated: true,
      });
    }
    await appsScript.post('delete_user', { id: String(req.params.id) });
    await appsScript.post('audit_log', {
      record: {
        action: 'delete',
        resource: 'User',
        recordId: String(req.params.id),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: row.departmentId || '',
        detail: `Removed account ${row.email}`,
      },
    });
    return res.json({ success: true, message: 'User deleted successfully' });
  })
);

/** Global cross-module search (admin only). */
router.get(
  '/search/global',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const term = req.query.q ? String(req.query.q) : '';
    if (!term) return res.json({ success: true, message: 'Operation successful', data: { students: [], faculty: [], subjects: [], departments: [], users: [] } });
    const [students, faculty, hods, subjects, departments, users] = await Promise.all([
      dataService.students(),
      dataService.faculty(),
      dataService.hods(),
      dataService.subjects(),
      dataService.departments(),
      dataService.users(),
    ]);
    return res.json({
      success: true,
      message: 'Operation successful',
      data: {
        students: students.filter((s) => dataService.matchesSearch(s, term, ['name', 'registerNumber', 'email'])).sort(byRegisterNumber).slice(0, 20),
        faculty: faculty.filter((f) => dataService.matchesSearch(f, term, ['name', 'employeeId', 'email'])).slice(0, 20),
        hods: hods.filter((h) => dataService.matchesSearch(h, term, ['name', 'employeeId', 'email'])).slice(0, 20),
        subjects: subjects.filter((s) => dataService.matchesSearch(s, term, ['subjectCode', 'subjectName'])).slice(0, 20),
        departments: departments.filter((d) => dataService.matchesSearch(d, term, ['departmentId', 'departmentCode', 'departmentName'])).slice(0, 20),
        users: users.filter((u) => dataService.matchesSearch(u, term, ['name', 'email'])).slice(0, 20).map(safeUser),
      },
    });
  })
);

module.exports = router;
module.exports.safeUser = safeUser;