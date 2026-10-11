/**
 * The ERP serves a single academic department: Computer Science and Engineering.
 *
 * Every department-scoped record carries this id, and the backend treats it as
 * the only valid department. `departmentId` is the permanent relationship key
 * (it is used across the frontend, the backend, Apps Script and Google Sheets),
 * and it intentionally equals `departmentCode` so a record and a dropdown can
 * never drift apart.
 *
 * Change the deployment's department by editing these four values and running
 * the single-department migration once (see DEPLOYMENT.md).
 */
const SINGLE_DEPARTMENT = {
  departmentId: 'CS01',
  departmentCode: 'CS01',
  departmentName: 'Computer Science and Engineering',
  status: 'active',
};

/** True when `value` names the one supported department id or code. */
const isSingleDepartment = (value) =>
  String(value || '').trim().toUpperCase() === SINGLE_DEPARTMENT.departmentId;

/** The canonical representation of any department row. */
const canonicalDepartment = (row) => ({
  ...(row || {}),
  departmentId: SINGLE_DEPARTMENT.departmentId,
  departmentCode: SINGLE_DEPARTMENT.departmentCode,
  departmentName: SINGLE_DEPARTMENT.departmentName,
  status: String((row && row.status) || SINGLE_DEPARTMENT.status).toLowerCase() === 'inactive' ? 'inactive' : SINGLE_DEPARTMENT.status,
});

module.exports = { SINGLE_DEPARTMENT, isSingleDepartment, canonicalDepartment };
