/**
 * Natural, register-number aware comparison.
 * "22CS010" sorts after "22CS009" (not before like plain lexicographic sorting would do).
 */
const chunkNumber = (chunk) => (/^\d+$/.test(chunk) ? Number(chunk) : null);

const naturalCompare = (a = '', b = '') => {
  const left = String(a).trim();
  const right = String(b).trim();
  const leftChunks = left.split(/(\d+)/).filter((c) => c !== '');
  const rightChunks = right.split(/(\d+)/).filter((c) => c !== '');
  const length = Math.max(leftChunks.length, rightChunks.length);
  for (let i = 0; i < length; i += 1) {
    const l = leftChunks[i];
    const r = rightChunks[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = chunkNumber(l);
    const rn = chunkNumber(r);
    if (ln !== null && rn !== null) {
      if (ln !== rn) return ln - rn;
    } else {
      const cmp = String(l).localeCompare(String(r), undefined, { sensitivity: 'base', numeric: true });
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
};

/** Ascending register-number / employee-id order used by every student & faculty list. */
const byRegisterNumber = (a, b) =>
  naturalCompare(a.registerNumber || a.register_number || '', b.registerNumber || b.register_number || '');

const byEmployeeId = (a, b) =>
  naturalCompare(a.employeeId || a.employee_id || '', b.employeeId || b.employee_id || '');

/**
 * Display-name order. Rows use different label columns per table (name,
 * departmentName, subjectName, ...), so fall back through them instead of
 * sorting every row as an empty string and leaving the order untouched.
 */
const labelFor = (row = {}) => row.name || row.departmentName || row.subjectName || row.title || row.departmentCode || '';

const byName = (a, b) =>
  String(labelFor(a)).localeCompare(String(labelFor(b)), undefined, { sensitivity: 'base' });

module.exports = { naturalCompare, byRegisterNumber, byEmployeeId, byName };