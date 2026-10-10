const router = require('express').Router();
const { crudFactory } = require('../services/crudFactory');
const { syncProfileAccount } = require('../services/accountService');
const { SPECS, withoutPassword } = require('../utils/validate');
const { byEmployeeId } = require('../utils/naturalSort');

const COMMON = {
  read: ['admin', 'hod'],
  create: ['admin', 'hod'],
  update: ['admin', 'hod'],
  delete: ['admin'],
};

/** Keeps the faculty login account aligned with the faculty profile. */
const syncAccount = async ({ record, previous, password, action }) => {
  await syncProfileAccount({ resource: 'Faculty', record: { ...(previous || {}), ...record }, previous, password, action });
};

router.use(
  crudFactory({
    resource: 'Faculty',
    table: 'faculty',
    idField: 'facultyId',
    createSpec: { ...SPECS.faculty },
    updateSpec: withoutPassword(SPECS.faculty),
    listSpec: { status: {}, departmentId: {}, designation: {} },
    searchFields: ['name', 'employeeId', 'email', 'phone', 'designation', 'departmentName', 'departmentCode'],
    uniqueKeys: [['employeeId'], ['email']],
    roles: COMMON,
    requiredReferences: [{ table: 'attendance', field: 'facultyId', matchField: 'facultyId', label: 'attendance records' }],
    afterCreate: syncAccount,
    afterUpdate: syncAccount,
    afterDelete: syncAccount,
    sort: byEmployeeId,
  })
);

module.exports = router;