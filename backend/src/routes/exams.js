const router = require('express').Router();
const { crudFactory } = require('../services/crudFactory');
const { SPECS } = require('../utils/validate');
const { badRequest } = require('../middleware/error');
const { timeToMinutes } = require('./timetableInternal');

router.use(
  crudFactory({
    resource: 'Exam',
    table: 'exams',
    idField: 'examId',
    createSpec: { ...SPECS.exam },
    updateSpec: { ...SPECS.exam },
    listSpec: { examType: {}, semester: {}, subjectCode: {}, departmentId: {}, date: {} },
    searchFields: ['examName', 'examType', 'subjectCode', 'subjectName', 'room'],
    // The same subject cannot be scheduled twice on one date within a department.
    uniqueKeys: [['subjectCode', 'date', 'departmentId']],
    roles: {
      read: ['admin', 'hod', 'faculty', 'student'],
      create: ['admin', 'hod'],
      update: ['admin', 'hod'],
      delete: ['admin', 'hod'],
    },
    sort: (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    beforeCreate: (data) => {
      if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
        throw badRequest('End time must be later than start time.', { endTime: 'Invalid time range' });
      }
    },
    beforeUpdate: (data) => {
      if (data.startTime && data.endTime && timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
        throw badRequest('End time must be later than start time.', { endTime: 'Invalid time range' });
      }
    },
  })
);

module.exports = router;