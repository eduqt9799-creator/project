const router = require('express').Router();
const appsScript = require('../services/appsScriptClient');
const dataService = require('../services/dataService');
const { requireRole } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound, forbidden } = require('../middleware/error');
const { toBool } = require('../services/dataService');
const { validate, SPECS } = require('../utils/validate');

/** Users can only ever read/act on their own notifications. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await dataService.notifications();
    const mine = rows.filter(
      (n) => String(n.userId || '') === String(req.user.userId) || String(n.userId || '') === String(req.user.email || '').toLowerCase()
    );
    const readFilter = req.query.isRead !== undefined && req.query.isRead !== '' ? String(req.query.isRead).toLowerCase() === 'true' : null;
    const filtered = mine
      .filter((n) => (readFilter === null ? true : toBool(n.isRead) === readFilter))
      .filter((n) => (req.query.type ? String(n.type).toLowerCase() === String(req.query.type).toLowerCase() : true))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const unreadCount = filtered.filter((n) => !toBool(n.isRead)).length;
    return res.json({ success: true, message: 'Operation successful', data: filtered, unreadCount });
  })
);

/**
 * Recipient picker for the notification composer.
 *
 * Admins may target anyone; an HOD is limited to their own department. Only
 * non-sensitive fields are returned (never passwordHash or profile ids).
 */
router.get(
  '/recipients',
  requireRole('admin', 'hod'),
  asyncHandler(async (req, res) => {
    const users = await dataService.users();
    const scoped =
      req.user.role === 'admin'
        ? users
        : users.filter((u) => String(u.departmentId || '') === String(req.user.departmentId || ''));
    const active = scoped
      .filter((u) => String(u.status || 'active').toLowerCase() === 'active')
      .filter((u) => String(u.role || '').toLowerCase() !== 'admin' || req.user.role === 'admin')
      .filter((u) => (req.query.role ? String(u.role || '').toLowerCase() === String(req.query.role).toLowerCase() : true))
      .map((u) => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        role: u.role,
        departmentId: u.departmentId,
        departmentName: u.departmentName,
      }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return res.json({ success: true, message: 'Operation successful', data: active, count: active.length });
  })
);

router.post(
  '/',
  requireRole('admin', 'hod'),
  asyncHandler(async (req, res) => {
    const { errors, data } = validate(req.body, SPECS.notification);
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
    const userId = String(req.body.userId || '');
    if (!userId) throw badRequest('Select a recipient.', { userId: 'Recipient is required' });
    const users = await dataService.users();
    const target = users.find((u) => String(u.userId) === userId);
    if (!target) throw notFound('Recipient not found');
    if (req.user.role !== 'admin' && String(target.departmentId || '') !== String(req.user.departmentId || '')) {
      throw forbidden('You cannot notify users outside your department.');
    }
    const result = await appsScript.post('create_notifications', {
      records: [{ userId, title: data.title, message: data.message, type: data.type || 'info' }],
    });
    return res.status(201).json({ success: true, message: 'Notification sent', data: result.data });
  })
);

router.put(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const rows = await dataService.notifications();
    const row = rows.find((n) => String(n.notificationId || '') === String(req.params.id));
    if (!row) throw notFound('Notification not found');
    if (String(row.userId || '') !== String(req.user.userId)) throw forbidden('This notification belongs to another user.');
    const result = await appsScript.post('update_notification', { id: String(req.params.id), record: { isRead: true, readAt: new Date().toISOString() } });
    return res.json({ success: true, message: 'Notification marked as read', data: result.data });
  })
);

router.put(
  '/read-all',
  asyncHandler(async (req, res) => {
    const rows = await dataService.notifications();
    const mine = rows.filter((n) => String(n.userId || '') === String(req.user.userId));
    const unread = mine.filter((n) => !toBool(n.isRead));
    for (const n of unread) {
      // eslint-disable-next-line no-await-in-loop
      await appsScript.post('update_notification', { id: String(n.notificationId), record: { isRead: true, readAt: new Date().toISOString() } });
    }
    return res.json({ success: true, message: `${unread.length} notification(s) marked as read` });
  })
);

module.exports = router;