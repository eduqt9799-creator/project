const router = require('express').Router();
const { crudFactory } = require('../services/crudFactory');
const { SPECS } = require('../utils/validate');
const { badRequest } = require('../middleware/error');
const { timeToMinutes } = require('./timetableInternal');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayIndex = (day) => DAYS.indexOf(String(day));
const badRequestTime = () => badRequest('End time must be later than start time.', { endTime: 'Invalid time range' });

router.use(
  crudFactory({
    resource: 'Timetable',
    table: 'timetable',
    idField: 'timetableId',
    createSpec: { ...SPECS.timetable },
    updateSpec: { ...SPECS.timetable },
    listSpec: { day: {}, semester: {}, subjectCode: {}, departmentId: {}, room: {} },
    searchFields: ['day', 'subjectCode', 'subjectName', 'room'],
    // One subject can only occupy a given day + start time + semester + department once.
    uniqueKeys: [['day', 'startTime', 'semester', 'departmentId', 'subjectCode']],
    roles: {
      read: ['admin', 'hod', 'faculty', 'student'],
      create: ['admin', 'hod'],
      update: ['admin', 'hod'],
      delete: ['admin', 'hod'],
    },
    sort: (a, b) => dayIndex(a.day) - dayIndex(b.day) || timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    beforeCreate: (data) => {
      if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) badRequestTime();
    },
    beforeUpdate: (data) => {
      if (data.startTime && data.endTime && timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) badRequestTime();
    },
  })
);

module.exports = router;
module.exports.DAYS = DAYS;