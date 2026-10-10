const router = require('express').Router();
const { crudFactory } = require('../services/crudFactory');
const { syncProfileAccount } = require('../services/accountService');
const { SPECS, withoutPassword } = require('../utils/validate');
const { byEmployeeId } = require('../utils/naturalSort');

/** Keeps the HOD login account aligned with the HOD profile. */
const syncAccount = async ({ record, previous, password, action }) => {
  await syncProfileAccount({ resource: 'HOD', record: { ...(previous || {}), ...record }, previous, password, action });
};

router.use(
  crudFactory({
    resource: 'HOD',
    table: 'hods',
    idField: 'hodId',
    createSpec: { ...SPECS.hod },
    updateSpec: withoutPassword(SPECS.hod),
    listSpec: { status: {}, departmentId: {} },
    searchFields: ['name', 'employeeId', 'email', 'phone', 'designation', 'departmentName', 'departmentCode'],
    uniqueKeys: [['employeeId'], ['email']],
    roles: {
      read: ['admin'],
      create: ['admin'],
      update: ['admin'],
      delete: ['admin'],
    },
    afterCreate: syncAccount,
    afterUpdate: syncAccount,
    afterDelete: syncAccount,
    sort: byEmployeeId,
  })
);

module.exports = router;