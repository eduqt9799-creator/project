const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const appsScript = require('../services/appsScriptClient');
const dataService = require('../services/dataService');
const { verifyPasswordLegacyAware } = require('../services/passwordHash');
const { signToken, ROLE_PRIORITY, authenticateUser } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/error');
const { validate, SPECS } = require('../utils/validate');
const { SINGLE_DEPARTMENT } = require('../config/department');

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in a few minutes.' },
});

const publicUser = (user) => ({
  userId: user.userId,
  name: user.name,
  email: user.email,
  role: user.role,
  departmentId: user.departmentId || '',
  departmentName: user.departmentName || '',
  status: user.status || 'active',
});

const findProfile = (all, user) => {
  const email = String(user.email || '').toLowerCase();
  if (user.role === 'student') {
    const found = all.students.find((s) => String(s.email || '').toLowerCase() === email || (user.registerNumber && String(s.registerNumber || '').toLowerCase() === String(user.registerNumber).toLowerCase()));
    return found ? { type: 'student', record: found } : null;
  }
  const key = user.role === 'faculty' ? all.faculty : all.hods;
  const found = key.find((f) => String(f.email || '').toLowerCase() === email);
  return found ? { type: user.role, record: found } : null;
};

/**
 * Loads the profile tables the signed-in role actually needs. Fetching all five
 * on every profile call wasted Apps Script round-trips and broke entirely on
 * deployments that have no HODs sheet, even for an admin who can never be one.
 */
const loadProfile = async (user) => {
  const role = String(user.role || '').toLowerCase();
  // Only the profile table the signed-in role needs is read; the department is a
  // deployment constant now, so it needs no bridge round-trip at all. Fetching
  // all five tables used to add 6-24s to every sign-in and broke entirely on
  // deployments that have no HODs sheet, even for an admin who can never be one.
  const [students, faculty, hods] = await Promise.all([
    role === 'student' ? dataService.students() : [],
    role === 'faculty' ? dataService.faculty() : [],
    role === 'hod' ? dataService.hods() : [],
  ]);
  const profile = findProfile({ students, faculty, hods }, user);
  return { user, profile };
};

const buildProfileResponse = async (user) => {
  const { profile } = await loadProfile(user);
  const record = profile ? profile.record : null;
  // The deployment has one department: every non-admin account is shown as the
  // canonical department, regardless of any legacy department value stored on
  // the row (the migration rewrites those, this keeps the UI correct meanwhile).
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const base = {
    ...publicUser(user),
    departmentId: isAdmin ? '' : SINGLE_DEPARTMENT.departmentId,
    departmentName: isAdmin ? '' : SINGLE_DEPARTMENT.departmentName,
    phone: record ? record.phone || '' : user.phone || '',
    registerNumber: record ? record.registerNumber || '' : '',
    employeeId: record ? record.employeeId || '' : '',
    semester: record && record.semester !== undefined ? Number(record.semester) : null,
    batch: record ? record.batch || '' : '',
    designation: record ? record.designation || '' : '',
    department: isAdmin
      ? null
      : { departmentId: SINGLE_DEPARTMENT.departmentId, departmentCode: SINGLE_DEPARTMENT.departmentCode, departmentName: SINGLE_DEPARTMENT.departmentName },
  };
  return base;
};

// POST /api/auth/login
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { errors, data } = validate(req.body, SPECS.login);
    if (Object.keys(errors).length) throw badRequest('Email and password are required.', errors);

    const users = await dataService.users();
    const user = users.find((u) => String(u.email || '').toLowerCase() === data.email.toLowerCase());
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const passwordHash = user.passwordHash || '';
    const ok = await verifyPasswordLegacyAware(data.password, passwordHash);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    if (String(user.status || 'active').toLowerCase() !== 'active') {
      return res.status(403).json({ success: false, message: 'This account is deactivated. Please contact the administrator.' });
    }
    if (!ROLE_PRIORITY.includes(String(user.role || '').toLowerCase())) {
      return res.status(403).json({ success: false, message: 'Account role is not recognised.' });
    }

    const token = signToken(user);
    return res.json({ success: true, message: 'Login successful', token, user: await buildProfileResponse(user) });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticateUser,
  asyncHandler(async (req, res) => {
    return res.json({ success: true, message: 'Operation successful', data: await buildProfileResponse(req.user) });
  })
);

// PUT /api/auth/password  (self service password change)
router.put(
  '/password',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8) throw badRequest('New password must be at least 8 characters.', { newPassword: 'Too short' });
    const users = await dataService.users();
    const user = users.find((u) => String(u.userId || '') === String(req.user.userId));
    if (!user) throw badRequest('Account not found');
    const ok = await verifyPasswordLegacyAware(currentPassword, user.passwordHash);
    if (!ok) throw badRequest('Current password is incorrect.', { currentPassword: 'Incorrect password' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await appsScript.post('update_user', { id: String(user.userId), record: { passwordHash } });
    return res.json({ success: true, message: 'Password updated successfully' });
  })
);

/**
 * PUT /api/auth/me — self service profile update.
 * Role, department and status are administrator-controlled and are rejected here.
 */
router.put(
  '/me',
  authenticateUser,
  asyncHandler(async (req, res) => {
    const payload = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 2) throw badRequest('Enter your name.', { name: 'Enter at least 2 characters' });
      payload.name = name;
    }
    if (req.body.email !== undefined) {
      const email = String(req.body.email).trim().toLowerCase();
      if (!SPECS.login.email.check(email)) throw badRequest('Enter a valid email address.', { email: 'Invalid email' });
      const users = await dataService.users();
      if (users.some((u) => String(u.userId) !== String(req.user.userId) && String(u.email || '').toLowerCase() === email)) {
        throw badRequest('An account with this email already exists.', { email: 'Already in use' });
      }
      payload.email = email;
    }
    if (req.body.phone !== undefined) {
      const phone = String(req.body.phone).trim();
      if (phone && !/^[0-9+\-\s]{6,15}$/.test(phone)) throw badRequest('Enter a valid phone number.', { phone: 'Invalid phone number' });
      payload.phone = phone;
    }
    ['role', 'departmentId', 'status', 'passwordHash', 'userId'].forEach((field) => {
      if (req.body[field] !== undefined) {
        throw badRequest(`${field} is managed by an administrator and cannot be changed here.`, { [field]: 'Not permitted' });
      }
    });
    if (!Object.keys(payload).length) throw badRequest('Nothing to update.');

    const result = await appsScript.post('update_user', { id: String(req.user.userId), record: payload });

    // Keep the linked Students/Faculty/HOD record in sync so name, email and phone
    // stay identical everywhere they are displayed.
    const [students, faculty, hods] = await Promise.all([dataService.students(), dataService.faculty(), dataService.hods()]);
    const email = String(payload.email || req.user.email || '').toLowerCase();
    const mirror = ['name', 'phone', ...(payload.email ? ['email'] : [])];
    const linked =
      req.user.role === 'student'
        ? { rows: students, key: 'studentId', id: req.user.studentId || req.user.registerNumber, field: 'registerNumber', value: req.user.registerNumber }
        : req.user.role === 'faculty'
          ? { rows: faculty, key: 'facultyId', id: req.user.facultyId || req.user.employeeId, field: 'email', value: email }
          : req.user.role === 'hod'
            ? { rows: hods, key: 'hodId', id: req.user.hodId || req.user.employeeId, field: 'email', value: email }
            : null;
    if (linked) {
      const target = linked.rows.find(
        (row) => String(row[linked.key] || '') === String(linked.id || '') || String(row[linked.field] || '').toLowerCase() === String(linked.value || '').toLowerCase()
      );
      if (target) {
        const profilePatch = {};
        mirror.forEach((field) => { if (payload[field] !== undefined) profilePatch[field] = payload[field]; });
        if (Object.keys(profilePatch).length) {
          await appsScript.post(`update_${linked.key.replace('Id', '')}`, { id: String(target[linked.key]), record: profilePatch });
        }
      }
    }

    await appsScript.post('audit_log', {
      record: {
        action: 'update',
        resource: 'User',
        recordId: String(req.user.userId),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: req.user.departmentId || '',
        detail: `Self service profile update: ${Object.keys(payload).join(', ')}`,
      },
    });

    const users = await dataService.users();
    const updated = users.find((u) => String(u.userId) === String(req.user.userId));
    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: await buildProfileResponse(updated || { ...req.user, ...payload }),
    });
  })
);

module.exports = router;