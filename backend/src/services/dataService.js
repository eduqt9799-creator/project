/**
 * Data access layer. Every read/write goes through Google Apps Script -> Google Sheets.
 * The department scope + role scope is applied here (server-side) BEFORE any response is sent.
 */
const appsScript = require('./appsScriptClient');
const cacheEpoch = require('./cacheEpoch');
const { byRegisterNumber, naturalCompare } = require('../utils/naturalSort');

/**
 * Short-lived read cache.
 *
 * The bridge takes 6-17s per table read, and reference tables (users,
 * departments) are requested on nearly every route — often several times within
 * one request. Without this, a sign-in alone spent 25s+ and timed out. Cached
 * reads are keyed by the current write generation, so any mutation discards
 * them, and concurrent reads of the same table share one in-flight request.
 */
const CACHE_TTL_MS = Number(process.env.DATA_CACHE_TTL_MS || 30000);
const cache = new Map();
const inflight = new Map();

const list = async (action) => {
  const key = `${cacheEpoch.get()}:${action}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = appsScript
    .get(action)
    .then((data) => {
      const rows = Array.isArray(data) ? data : Array.isArray(data && data.rows) ? data.rows : [];
      cache.set(key, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
};

/** Drop every cached table. Called after a write when no epoch bump is enough. */
const invalidateCache = () => {
  cache.clear();
};

const matchText = (haystack, needle) => String(haystack || '').toLowerCase().includes(needle);

const matchesSearch = (row, term, fields) => {
  if (!term) return true;
  const needle = String(term).trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => matchText(row[field], needle));
};

const paginate = (rows, page, limit) => {
  const total = rows.length;
  const safeLimit = Math.max(1, Number(limit) || 25);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (currentPage - 1) * safeLimit;
  return {
    rows: rows.slice(start, start + safeLimit),
    pagination: { page: currentPage, limit: safeLimit, total, totalPages, hasPrev: currentPage > 1, hasNext: currentPage < totalPages },
  };
};

const removeUndefined = (obj) =>
  Object.entries(obj).reduce((acc, [key, value]) => {
    if (value !== undefined) acc[key] = value;
    return acc;
  }, {});

/**
 * Google Sheets has no boolean cell type, so booleans arrive as the strings
 * "TRUE"/"FALSE". `Boolean('FALSE')` is `true`, which silently inverted every
 * "isRead" check, so normalise explicitly.
 */
const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'y';
};

/**
 * The legacy deployment stores users with generic columns
 * (id / name / email / password / role / department / status), while the rest of
 * the backend expects userId / fullName / passwordHash / departmentId. Map them
 * here so every route sees one shape regardless of which script is deployed.
 * Fields that are already correct are left untouched.
 */
const normalizeUser = (row) => {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if (out.userId === undefined && out.id !== undefined) out.userId = String(out.id);
  if (out.fullName === undefined && out.name !== undefined) out.fullName = out.name;
  if (out.passwordHash === undefined && out.password !== undefined) out.passwordHash = out.password;
  if (out.departmentId === undefined && out.department !== undefined && !out.departmentId) {
    // Legacy rows carry a department *name*; keep it so the UI can display it.
    out.departmentName = out.department;
    out.departmentId = '';
  }
  if (out.isActive === undefined && out.status !== undefined) {
    out.isActive = String(out.status).toLowerCase() === 'active';
  }
  return out;
};

/**
 * Subject allocations carry the department, semester, subject and the assigned
 * faculty. Normalise the keys and codes so lookups by semester / subjectCode /
 * facultyId are reliable regardless of how the sheet stored them.
 */
const normalizeAllocation = (row) => {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  out.allocationId = String(out.allocationId || out.id || '').trim();
  out.subjectCode = String(out.subjectCode || '').trim().toUpperCase();
  out.semester = Number(out.semester);
  out.facultyId = String(out.facultyId || '').trim();
  out.departmentId = String(out.departmentId || '').trim();
  if (!out.status) out.status = 'active';
  return out;
};

/**
 * The connected Apps Script keeps its own generated `id` on Departments and
 * stores only id / departmentCode / departmentName / createdAt / updatedAt.
 * Downstream code (and every department dropdown) keys on `departmentId`, so
 * fall back to the code, then the row id, and default `status` to active.
 */
const normalizeDepartment = (row) => {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  out.departmentId = String(out.departmentId || out.departmentCode || out.id || '').trim();
  if (!out.departmentCode) out.departmentCode = out.departmentId;
  if (!out.status) out.status = 'active';
  return out;
};

module.exports = {
  list,
  invalidateCache,
  normalizeUser,
  normalizeDepartment,
  normalizeAllocation,
  matchesSearch,
  paginate,
  removeUndefined,
  toBool,
  byRegisterNumber,
  naturalCompare,
  // table accessors
  users: () => list('users').then((rows) => rows.map(normalizeUser)),
  students: () => list('students'),
  faculty: () => list('faculty'),
  hods: () => list('hods'),
  departments: () => list('departments').then((rows) => rows.map(normalizeDepartment)),
  subjects: () => list('subjects'),
  subjectAllocations: () => list('subject_allocations').then((rows) => rows.map(normalizeAllocation)),
  attendance: () => list('attendance'),
  materials: () => list('materials'),
  assignments: () => list('assignments'),
  assignmentSubmissions: () => list('assignment_submissions'),
  marks: () => list('marks'),
  timetable: () => list('timetable'),
  exams: () => list('exams'),
  announcements: () => list('announcements'),
  notifications: () => list('notifications'),
};