/**
 * Semester-then-subject-code ordering, shared by subjects and allocations so a
 * subject and its allocation always appear in the same relative order.
 * Subject codes sort naturally ("CS3A" before "CS10A").
 */
const { naturalCompare } = require('./naturalSort');

const bySemesterThenCode = (a, b) => {
  const semester = Number(a.semester || 0) - Number(b.semester || 0);
  if (semester !== 0) return semester;
  return naturalCompare(a.subjectCode || '', b.subjectCode || '');
};

module.exports = { bySemesterThenCode };