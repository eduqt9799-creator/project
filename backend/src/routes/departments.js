const router = require('express').Router();
const dataService = require('../services/dataService');
const appsScript = require('../services/appsScriptClient');
const { validate, SPECS } = require('../utils/validate');
const { asyncHandler, badRequest, forbidden, notFound } = require('../middleware/error');
const { byName } = require('../utils/naturalSort');
const { requireRole } = require('../middleware/auth');

/**
 * Departments are reference data.
 * Every authenticated user may read them (labels / admin filter dropdown),
 * but only an administrator may create, update or remove them.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const departments = await dataService.departments();
    const term = req.query.search ? String(req.query.search) : '';
    const status = req.query.status ? String(req.query.status).toLowerCase() : '';
    const rows = departments
      .filter((d) => dataService.matchesSearch(d, term, ['departmentId', 'departmentCode', 'departmentName']))
      .filter((d) => (status ? String(d.status || 'active').toLowerCase() === status : true))
      .sort(byName);
    return res.json({ success: true, message: 'Operation successful', data: rows });
  })
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { errors, data } = validate(req.body, SPECS.department);
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
    const existing = await dataService.departments();
    if (existing.some((d) => String(d.departmentId).toLowerCase() === data.departmentId.toLowerCase())) {
      throw badRequest('A department with this ID already exists.', { departmentId: 'Already in use' });
    }
    if (existing.some((d) => String(d.departmentCode).toLowerCase() === data.departmentCode.toLowerCase())) {
      throw badRequest('A department with this code already exists.', { departmentCode: 'Already in use' });
    }
    const result = await appsScript.post('create_department', { record: data });
    return res.status(201).json({ success: true, message: 'Department created successfully', data: result.data || data });
  })
);

router.put(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { errors, data } = validate(req.body, SPECS.department);
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
    const existing = await dataService.departments();
    const target = String(req.params.id);
    // This deployment keys its rows by its own generated `id`, so accept either
    // that key or the readable departmentId/code the UI holds.
    const row = existing.find((d) => String(d.id || '') === target || String(d.departmentId) === target);
    if (!row) throw notFound('Department not found');
    const sheetId = String(row.id || row.departmentId);
    const others = existing.filter((d) => d !== row);
    if (data.departmentId && data.departmentId !== row.departmentId) {
      throw badRequest('Department ID cannot be changed after creation.');
    }
    if (others.some((d) => String(d.departmentCode).toLowerCase() === data.departmentCode.toLowerCase())) {
      throw badRequest('A department with this code already exists.', { departmentCode: 'Already in use' });
    }
    const result = await appsScript.post('update_department', { id: sheetId, record: data });
    return res.json({ success: true, message: 'Department updated successfully', data: result.data || { ...row, ...data } });
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await dataService.departments();
    const target = String(req.params.id);
    const row = existing.find((d) => String(d.id || '') === target || String(d.departmentId) === target);
    if (!row) throw notFound('Department not found');
    const sheetId = String(row.id || row.departmentId);

    const blockers = [];
    const checks = [
      ['students', 'students'],
      ['faculty', 'faculty members'],
      ['hods', 'HOD accounts'],
      ['subjects', 'subjects'],
    ];
    // eslint-disable-next-line no-restricted-syntax
    for (const [table, label] of checks) {
      let rows;
      try {
        // eslint-disable-next-line no-await-in-loop
        rows = await dataService[table]();
      } catch (error) {
        // A table this deployment does not have cannot be holding references,
        // so it is not a blocker. Anything else is a real failure.
        if (error.reason === 'table_not_supported') continue;
        throw error;
      }
      if (rows.some((r) => String(r.departmentId || '') === String(row.departmentId))) blockers.push(label);
    }
    if (req.user.role !== 'admin') throw forbidden('Only administrators can remove departments.');

    if (blockers.length) {
      await appsScript.post('update_department', { id: sheetId, record: { status: 'inactive' } });
      await appsScript.post('audit_log', {
        record: {
          action: 'update',
          resource: 'Department',
          recordId: String(row.departmentId),
          performedBy: req.user.userId,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          departmentId: '',
          detail: `deactivated because referenced by ${blockers.join(', ')}`,
        },
      });
      return res.json({
        success: true,
        message: `This department still contains ${blockers.join(', ')} and cannot be deleted. It has been deactivated instead.`,
        deactivated: true,
      });
    }

    await appsScript.post('delete_department', { id: sheetId });
    await appsScript.post('audit_log', {
      record: {
        action: 'delete',
        resource: 'Department',
        recordId: String(row.departmentId),
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: '',
        detail: row.departmentName,
      },
    });
    return res.json({ success: true, message: 'Department deleted successfully' });
  })
);

module.exports = router;