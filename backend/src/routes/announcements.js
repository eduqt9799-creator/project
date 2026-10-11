const router = require('express').Router();
const appsScript = require('../services/appsScriptClient');
const dataService = require('../services/dataService');
const { requireRole, actorOf } = require('../middleware/auth');
const { asyncHandler, badRequest, forbidden, notFound } = require('../middleware/error');
const { validate, SPECS } = require('../utils/validate');
const { SINGLE_DEPARTMENT } = require('../config/department');

const today = () => new Date().toISOString().slice(0, 10);

/** Students only ever see announcements targeted at them / their department. */
const visibleToStudent = (row, user, semester) => {
  const target = String(row.targetRole || 'all').toLowerCase();
  if (!['all', 'student'].includes(target)) return false;
  if (row.departmentId && String(row.departmentId) !== String(user.departmentId || '')) return false;
  if (row.semester && semester && Number(row.semester) !== Number(semester)) return false;
  return true;
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    let rows = await dataService.announcements();
    const role = req.user.role;

    if (role === 'student') {
      const students = await dataService.students();
      const me = students.find((s) => String(s.email || '').toLowerCase() === String(req.user.email).toLowerCase());
      const semester = me ? Number(me.semester) : null;
      rows = rows.filter((r) => visibleToStudent(r, req.user, semester));
    } else if (role === 'faculty' || role === 'hod') {
      rows = rows.filter((r) => {
        const target = String(r.targetRole || 'all').toLowerCase();
        const roleMatch = ['all', 'faculty', 'hod'].includes(target);
        const deptMatch = !r.departmentId || String(r.departmentId) === String(req.user.departmentId || '');
        return roleMatch && deptMatch;
      });
    }

    if (req.query.departmentId) rows = rows.filter((r) => String(r.departmentId || '') === String(req.query.departmentId));
    if (req.query.category) rows = rows.filter((r) => String(r.category).toLowerCase() === String(req.query.category).toLowerCase());
    if (req.query.priority) rows = rows.filter((r) => String(r.priority).toLowerCase() === String(req.query.priority).toLowerCase());
    if (req.query.targetRole) rows = rows.filter((r) => String(r.targetRole).toLowerCase() === String(req.query.targetRole).toLowerCase());
    if (req.query.search) rows = rows.filter((r) => dataService.matchesSearch(r, req.query.search, ['title', 'description', 'category']));

    const sorted = [...rows].sort((a, b) => {
      const d = String(b.publishDate || '').localeCompare(String(a.publishDate || ''));
      return d !== 0 ? d : String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    return res.json({ success: true, message: 'Operation successful', data: sorted });
  })
);

router.post(
  '/',
  requireRole('admin', 'hod', 'faculty'),
  asyncHandler(async (req, res) => {
    const { errors, data } = validate(req.body, SPECS.announcement);
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);

    // Single-department deployment: a department announcement is always CS01. An
    // admin may still publish a global (department-less) notice by omitting it.
    const departmentId = req.user.role === 'admin'
      ? (req.body.departmentId ? SINGLE_DEPARTMENT.departmentId : '')
      : SINGLE_DEPARTMENT.departmentId;
    if (req.user.role === 'faculty' && data.targetRole !== 'faculty' && data.targetRole !== 'all') {
      throw forbidden('Faculty may only publish faculty/all announcements.');
    }
    if (data.publishDate > today()) throw badRequest('Publish date cannot be in the future.', { publishDate: 'Future date' });

    const departments = await dataService.departments();
    const department = departments.find((d) => String(d.departmentId || '') === departmentId);
    const record = {
      ...data,
      departmentId,
      departmentName: department ? department.departmentName : '',
      createdBy: req.user.userId,
      createdByName: req.user.name,
    };
    const result = await appsScript.post('create_announcement', { record }, actorOf(req));

    // Notify the intended audience (real users only).
    const users = await dataService.users();
    const audience = users.filter(
      (u) =>
        String(u.status || 'active').toLowerCase() === 'active' &&
        String(u.role).toLowerCase() === (data.targetRole === 'all' ? u.role : data.targetRole) &&
        (departmentId ? String(u.departmentId || '') === departmentId : true)
    );
    if (audience.length) {
      await appsScript.post('create_notifications', {
        records: audience.map((u) => ({
          userId: u.userId,
          title: data.title,
          message: data.description,
          type: data.priority === 'high' ? 'alert' : 'info',
        })),
      });
    }
    await appsScript.post('audit_log', {
      record: {
        action: 'create',
        resource: 'Announcement',
        recordId: (result.data && result.data.announcementId) || '',
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId,
        detail: data.title,
      },
    });
    return res.status(201).json({ success: true, message: 'Announcement published', data: result.data || record });
  })
);

router.put(
  '/:id',
  requireRole('admin', 'hod', 'faculty'),
  asyncHandler(async (req, res) => {
    const rows = await dataService.announcements();
    const row = rows.find((a) => String(a.announcementId || '') === String(req.params.id));
    if (!row) throw notFound('Announcement not found');
    if (req.user.role !== 'admin' && row.departmentId && String(row.departmentId) !== String(req.user.departmentId || '')) {
      throw forbidden('You cannot modify announcements outside your department.');
    }
    if (req.user.role === 'faculty' && row.createdBy !== req.user.userId) {
      throw forbidden('Faculty may only modify announcements they created.');
    }
    const { errors, data } = validate(req.body, SPECS.announcement);
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
    const result = await appsScript.post(
      'update_announcement',
      { id: String(req.params.id), record: { ...data, updatedBy: req.user.userId } },
      actorOf(req)
    );
    await appsScript.post('audit_log', {
      record: {
        action: 'update',
        resource: 'Announcement',
        recordId: String(row.announcementId),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: row.departmentId || '',
        detail: data.title,
      },
    });
    return res.json({ success: true, message: 'Announcement updated', data: result.data });
  })
);

router.delete(
  '/:id',
  requireRole('admin', 'hod', 'faculty'),
  asyncHandler(async (req, res) => {
    const rows = await dataService.announcements();
    const row = rows.find((a) => String(a.announcementId || '') === String(req.params.id));
    if (!row) throw notFound('Announcement not found');
    if (req.user.role !== 'admin' && row.departmentId && String(row.departmentId) !== String(req.user.departmentId || '')) {
      throw forbidden('You cannot remove announcements outside your department.');
    }
    if (req.user.role === 'faculty' && row.createdBy !== req.user.userId) {
      throw forbidden('Faculty may only remove announcements they created.');
    }
    const result = await appsScript.post('delete_announcement', { id: String(req.params.id) });
    await appsScript.post('audit_log', {
      record: {
        action: 'delete',
        resource: 'Announcement',
        recordId: String(row.announcementId),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: row.departmentId || '',
        detail: row.title,
      },
    });
    return res.json({ success: true, message: 'Announcement removed', data: result.data });
  })
);

module.exports = router;