/**
 * Assignment status derivation - kept in one place so the backend and any
 * scheduled job derive identical results.
 *
 * `submission` is the signed-in student's own submission row (see the
 * AssignmentSubmissions sheet); when present it always wins, otherwise the
 * status is derived from the due date.
 */
const computeAssignmentStatus = (row, now = new Date(), submission = null) => {
  if (submission && String(submission.status || 'submitted').toLowerCase() !== 'withdrawn') return 'submitted';
  const explicit = String(row.status || '').toLowerCase();
  if (['submitted', 'completed', 'withdrawn'].includes(explicit)) return explicit;
  if (!row.dueDate) return 'pending';
  const due = new Date(`${row.dueDate}T23:59:59`);
  if (Number.isNaN(due.getTime())) return 'pending';
  return due.getTime() < now.getTime() ? 'overdue' : 'pending';
};

module.exports = { computeAssignmentStatus };