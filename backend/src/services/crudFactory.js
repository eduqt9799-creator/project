const express = require('express');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const appsScript = require('./appsScriptClient');
const dataService = require('./dataService');
const { validate } = require('../utils/validate');
const { ApiError, asyncHandler, notFound, badRequest, forbidden } = require('../middleware/error');
const { naturalCompare } = require('../utils/naturalSort');
const { loadStudentProfile } = require('../utils/studentScope');
const { actorOf } = require('../middleware/auth');
const { SINGLE_DEPARTMENT } = require('../config/department');

const hashPassword = (plain) => bcrypt.hash(String(plain), env.bcryptRounds);

/**
 * Students only ever see rows that belong to their own semester. The profile is
 * resolved once per request and cached on `req.profile`; if it cannot be
 * resolved nothing is returned rather than leaking another semester's rows.
 *
 * The profile is always resolved via `loadStudentProfile` — never read straight
 * from `req.user.profile`, because some middlewares used to stamp the Users row
 * (which has no `semester`) onto that field, making every real row invisible.
 */
const applyStudentScope = async (rows, req) => {
  if (req.user.role !== 'student') return rows;
  const noSemester = (row) => row.semester === undefined || row.semester === '';
  const profile = await loadStudentProfile(req, dataService);
  if (!profile) return rows.filter(noSemester);
  const semester = Number(profile.semester);
  if (!Number.isFinite(semester)) return rows.filter(noSemester);
  return rows.filter((row) => noSemester(row) || Number(row.semester) === semester);
};

const AUDIT_ACTION = (action) => `audit_log`;

/**
 * Generic, role- and department-scoped CRUD router.
 *
 * Every module in the ERP is described by this factory so that department scope,
 * role checks, duplicate prevention, soft-delete guards and audit logging are
 * implemented exactly once and cannot be forgotten.
 */
const crudFactory = (config) => {
  const {
    resource,
    table,
    idField = 'recordId',
    createSpec,
    updateSpec = createSpec,
    listSpec = {},
    searchFields = ['name'],
    uniqueKeys = [],
    roles,
    scopeField = 'departmentId',
    // Action names are case-insensitive on the bridge, but the canonical form is
    // lowercase: the deployed Apps Script maps "create_hod"/"create_student"/...
    // (lowercase, singular or plural) to a sheet, while "create_HOD" (the raw
    // PascalCase resource) hits no entry and is refused as
    // "Unknown POST action: create_HOD". Lowercase keeps the backend and the
    // bridge contract in sync without expecting an Apps Script redeploy.
    createAction = `create_${resource.toLowerCase()}`,
    updateAction = `update_${resource.toLowerCase()}`,
    deleteAction = `delete_${resource.toLowerCase()}`,
    requiredReferences = [],
    sort = (a, b) => naturalCompare(a[idField] || '', b[idField] || ''),
    auditOn = ['create', 'update', 'delete'],
    transformCreate,
    transformUpdate,
    prepareDelete,
    extraFilter,
    beforeCreate,
    beforeUpdate,
    beforeDelete,
    afterCreate,
    afterUpdate,
    afterDelete,
  } = config;

  const router = express.Router();

  const assertRole = (req, action) => {
    const allowed = roles[action];
    if (!allowed || !allowed.includes(req.user.role)) {
      throw forbidden('You do not have permission to perform this action.');
    }
  };

  const inScope = (user, row) => {
    if (user.role === 'admin') return true;
    const own = String(user.departmentId || '');
    const rowDept = String(row[scopeField] || '');
    return own !== '' && rowDept === own;
  };

  const writeAudit = async (req, action, targetId, detail) => {
    if (!auditOn.includes(action)) return;
    try {
      await appsScript.post(AUDIT_ACTION(action), {
        record: {
          action,
          resource,
          recordId: String(targetId || ''),
          performedBy: req.user.userId,
          performedByName: req.user.name,
          performedByRole: req.user.role,
          departmentId: req.user.departmentId || '',
          detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[audit] failed to write audit log', error.message);
    }
  };

  /**
   * Duplicate prevention for compound keys.
   * `uniqueKeys` is a list of key-groups; a group is only violated when EVERY key
   * in it matches (e.g. subjectCode + semester + departmentId), so the same
   * subject code may legitimately exist in a different semester or department.
   */
  const assertUnique = (existing, data, scopeUser, ignoreId) => {
    uniqueKeys.forEach((group) => {
      const keys = Array.isArray(group) ? group : [group];
      const active = keys.filter((key) => data[key] !== undefined && data[key] !== null && String(data[key]) !== '');
      if (!active.length) return;
      const clash = existing.find((row) => {
        if (ignoreId && String(row[idField] || '') === String(ignoreId)) return false;
        if (!inScope(scopeUser, row)) return false;
        return active.every((key) => {
          const incoming = String(data[key] ?? '').trim().toLowerCase();
          const current = String(row[key] ?? '').trim().toLowerCase();
          if (key === 'semester') return Number(row.semester) === Number(data.semester);
          return current === incoming;
        });
      });
      if (clash) {
        const labels = keys.map((key) => key.replace(/([A-Z])/g, ' $1').toLowerCase()).join(' + ');
        const [field] = active;
        throw badRequest(`A record with this ${labels} already exists.`, { [field]: 'Already in use' });
      }
    });
  };

  // ---------------------------------------------------------------- READ
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      assertRole(req, 'read');
      const all = await dataService[table]();

      const term = req.query.search ? String(req.query.search) : '';
      const filters = {};
      Object.keys(listSpec).forEach((key) => {
        const value = req.query[key];
        if (value !== undefined && value !== '' && value !== 'all') filters[key] = value;
      });

      let rows = all.filter((row) => inScope(req.user, row));
      rows = await applyStudentScope(rows, req);
      if (extraFilter) {
        const verdicts = await Promise.all(rows.map((row) => extraFilter(row, req)));
        rows = rows.filter((_, index) => verdicts[index]);
      }
      if (term) rows = rows.filter((row) => dataService.matchesSearch(row, term, searchFields));
      Object.entries(filters).forEach(([key, value]) => {
        rows = rows.filter((row) => {
          if (key === 'semester') return Number(row.semester) === Number(value);
          if (key === 'status') return String(row.status || 'active').toLowerCase() === String(value).toLowerCase();
          if (key === 'departmentId' || key === 'departmentCode') return String(row[key] || '') === String(value);
          return String(row[key] ?? '') === String(value);
        });
      });

      const sortKey = req.query.sortBy ? String(req.query.sortBy) : '';
      const direction = String(req.query.sortDir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
      const sorted = sortKey ? [...rows].sort((a, b) => direction * naturalCompare(a[sortKey] || '', b[sortKey] || '')) : [...rows].sort(sort);

      const { rows: pageRows, pagination } = dataService.paginate(sorted, req.query.page, req.query.limit);
      return res.json({ success: true, message: 'Operation successful', data: pageRows, pagination });
    })
  );

  // ---------------------------------------------------------------- CREATE
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      assertRole(req, 'create');
      const { errors, data } = validate(req.body, createSpec);
      if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);

      // The deployment serves one department, so every record belongs to it -
      // a departmentId in the client body is ignored rather than trusted.
      if (scopeField === 'departmentId') {
        data.departmentId = SINGLE_DEPARTMENT.departmentId;
      } else if (scopeField && !data[scopeField]) {
        data[scopeField] = req.user.role === 'admin' ? '' : req.user.departmentId || '';
      }

      const existing = await dataService[table]();
      assertUnique(existing, data, req.user, null);

      const plainPassword = data.password;
      if (data.password) data.passwordHash = await hashPassword(data.password);
      delete data.password;

      if (beforeCreate) await beforeCreate(data, req, null);

      const record = { ...(transformCreate ? transformCreate(data, req) : data) };
      if (scopeField === 'departmentId') record.departmentId = SINGLE_DEPARTMENT.departmentId;
      else if (scopeField && req.user.role !== 'admin') record[scopeField] = req.user.departmentId || '';

      const result = await appsScript.post(createAction, { record }, actorOf(req));
      const created = (result && result.data) || null;
      if (afterCreate) await afterCreate({ req, record: created || record, previous: null, password: plainPassword, action: 'create' });
      await writeAudit(req, 'create', created ? created[idField] : record[idField] || '', dataService.removeUndefined(record));
      return res.status(201).json({ success: true, message: `${resource} created successfully`, data: created || record });
    })
  );

  // ---------------------------------------------------------------- UPDATE
  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      assertRole(req, 'update');
      const { errors, data } = validate(req.body, updateSpec);
      if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);

      const all = await dataService[table]();
      const existingRow = all.find((row) => String(row[idField] || '') === String(req.params.id));
      if (!existingRow) throw notFound(`${resource} not found`);
      if (!inScope(req.user, existingRow)) throw forbidden('You cannot modify records outside your department.');

      // Records can never move between departments: there is only one.
      if (scopeField === 'departmentId') data.departmentId = SINGLE_DEPARTMENT.departmentId;

      assertUnique(all, data, req.user, req.params.id);

      const plainPassword = data.password;
      if (data.password) data.passwordHash = await hashPassword(data.password);
      delete data.password;

      if (beforeUpdate) await beforeUpdate(data, req, existingRow);

      const patch = dataService.removeUndefined({ ...(transformUpdate ? transformUpdate(data, req, existingRow) : data) });
      const result = await appsScript.post(updateAction, { id: String(req.params.id), record: patch }, actorOf(req));
      const updated = (result && result.data) || { ...existingRow, ...patch };
      if (afterUpdate) await afterUpdate({ req, record: updated, previous: existingRow, password: plainPassword, action: 'update' });
      await writeAudit(req, 'update', req.params.id, patch);
      return res.json({ success: true, message: `${resource} updated successfully`, data: updated });
    })
  );

  // ---------------------------------------------------------------- DELETE / DEACTIVATE
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      assertRole(req, 'delete');
      const all = await dataService[table]();
      const existingRow = all.find((row) => String(row[idField] || '') === String(req.params.id));
      if (!existingRow) throw notFound(`${resource} not found`);
      if (!inScope(req.user, existingRow)) throw forbidden('You cannot remove records outside your department.');
      // Ownership guard, e.g. a faculty member may only delete their own uploads.
      if (beforeDelete) await beforeDelete(existingRow, req);

      // Referential-integrity guard: never destroy academic history.
      const blockers = [];
      for (const ref of requiredReferences) {
        // eslint-disable-next-line no-await-in-loop
        const refRows = await dataService[ref.table]();
        const hit = refRows.find((row) => String(row[ref.field] ?? '') === String(existingRow[ref.matchField] ?? ''));
        if (hit) blockers.push(ref.label);
      }

      if (blockers.length) {
        const result = await appsScript.post(updateAction, { id: String(req.params.id), record: { status: 'inactive' } }, actorOf(req));
        if (afterDelete) await afterDelete({ req, record: existingRow, previous: existingRow, action: 'deactivate' });
        await writeAudit(req, 'update', req.params.id, `deactivated because referenced by ${blockers.join(', ')}`);
        return res.json({
          success: true,
          message: `This record is referenced by ${blockers.join(', ')} and cannot be deleted. It has been deactivated instead.`,
          data: result && result.data,
          deactivated: true,
        });
      }

      const result = await appsScript.post(deleteAction, { id: String(req.params.id) }, actorOf(req));
      if (afterDelete) await afterDelete({ req, record: existingRow, previous: existingRow, action: 'delete' });
      await writeAudit(req, 'delete', req.params.id, prepareDelete ? prepareDelete(existingRow) : {});
      return res.json({ success: true, message: `${resource} deleted successfully`, data: result && result.data });
    })
  );

  return router;
};

module.exports = { crudFactory, hashPassword, ApiError };