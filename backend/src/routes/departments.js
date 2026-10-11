const router = require('express').Router();
const dataService = require('../services/dataService');
const appsScript = require('../services/appsScriptClient');
const { asyncHandler } = require('../middleware/error');
const { byName } = require('../utils/naturalSort');
const { requireRole } = require('../middleware/auth');
const { SINGLE_DEPARTMENT } = require('../config/department');

/**
 * The ERP serves exactly one department (Computer Science and Engineering,
 * CS01). The department is a deployment constant, not user-managed data: the
 * endpoint is read-only and every account is pinned to the same values. The
 * one-time migration route rewrites any legacy department rows in Google Sheets.
 */
const readOnly = (res) =>
  res.status(400).json({
    success: false,
    message: `This ERP uses a single department (${SINGLE_DEPARTMENT.departmentName}). Departments cannot be added, renamed or removed.`,
    data: SINGLE_DEPARTMENT,
  });

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

/**
 * POST /api/departments/migrate — one-time, administrator-only migration.
 * The Apps Script bridge reassigns every department-scoped row to CS01 and
 * collapses the Departments sheet to a single row. It is idempotent.
 */
router.post(
  '/migrate',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const result = await appsScript.post('migrate_single_department', {});
    await appsScript.post('audit_log', {
      record: {
        action: 'update',
        resource: 'Department',
        recordId: SINGLE_DEPARTMENT.departmentId,
        performedBy: req.user.userId,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        departmentId: SINGLE_DEPARTMENT.departmentId,
        detail: 'Single-department migration run',
      },
    });
    return res.json({
      success: true,
      message: result.message || 'Single-department migration complete.',
      data: result.data || null,
    });
  })
);

// The single department is fixed; destructive/creative writes are refused so a
// duplicate CSE record can never be created by accident.
router.post('/', requireRole('admin'), asyncHandler(async (req, res) => readOnly(res)));
router.put('/:id', requireRole('admin'), asyncHandler(async (req, res) => readOnly(res)));
router.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => readOnly(res)));

module.exports = router;
