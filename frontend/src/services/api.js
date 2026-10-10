/**
 * Centralised API service.
 * Every component talks to the backend through this module — no raw fetch elsewhere.
 */
import axios from 'axios';

const TOKEN_KEY = 'hde.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  headers: { 'Content-Type': 'application/json' },
  // Must exceed the backend's APPS_SCRIPT_TIMEOUT_MS, otherwise the browser
  // aborts first and reports a generic network error instead of the real cause.
  timeout: 70000,
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized = null;
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

export class ApiError extends Error {
  constructor(message, status, fieldErrors) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors || null;
  }
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const body = error.response?.data;
    const message =
      body?.message ||
      (error.code === 'ECONNABORTED'
        ? 'The request timed out. Please try again.'
        : error.response
          ? 'The request could not be completed.'
          : 'Unable to reach the server. Check that the API is running and try again.');

    if (status === 401 && onUnauthorized) onUnauthorized();
    return Promise.reject(new ApiError(message, status || 0, body?.errors || null));
  }
);

const unwrap = (response) => ({
  data: response.data?.data ?? response.data?.rows ?? [],
  pagination: response.data?.pagination || null,
  unreadCount: response.data?.unreadCount,
  message: response.data?.message || '',
  raw: response.data,
});

export const http = {
  get: (url, params) => api.get(url, { params }).then(unwrap),
  post: (url, body) => api.post(url, body).then(unwrap),
  put: (url, body) => api.put(url, body).then(unwrap),
  del: (url, body) => api.delete(url, { data: body }).then(unwrap),
};

/* ----------------------------------------------------------------- modules */

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  updateProfile: (body) => api.put('/auth/me', body).then((r) => r.data),
  changePassword: (currentPassword, newPassword) => api.put('/auth/password', { currentPassword, newPassword }).then((r) => r.data),
};

export const dashboardApi = {
  get: () => http.get('/dashboard'),
  /** HOD Department Control Center: allocation coverage, workload, at-risk students. */
  controlCenter: (params) => http.get('/dashboard/control-center', params),
};

const resource = (path) => ({
  list: (params) => http.get(path, params),
  lookup: (params) => http.get(`${path}/lookup`, params),
  get: (id) => http.get(`${path}/${id}`),
  create: (body) => http.post(path, body),
  update: (id, body) => http.put(`${path}/${id}`, body),
  remove: (id, body) => http.del(`${path}/${id}`, body),
});

/** Faculty: only the subjects allocated to them. */
export const studentsApi = {
  ...resource('/students'),
  lookup: (params) => http.get('/students/lookup', params),
  mine: (params) => http.get('/students/mine', params),
};

/**
 * Subject allocation. `mine` is the faculty dashboard's own subjects and
 * `teachers` is the student's resolved HOD + subject teachers.
 */
export const subjectAllocationsApi = {
  ...resource('/subject-allocations'),
  mine: (params) => http.get('/subject-allocations/mine', params),
  teachers: () => http.get('/subject-allocations/teachers'),
};

export const facultyApi = resource('/faculty');
export const hodsApi = resource('/hods');
export const subjectsApi = { ...resource('/subjects'), lookup: (params) => http.get('/subjects/lookup', params) };

/** Faculty: `mine` (own uploads) and `teachable` (allocated subject dropdown). */
export const materialsApi = {
  ...resource('/materials'),
  mine: (params) => http.get('/materials/mine', params),
  teachable: () => http.get('/materials/teachable'),
};
export const timetableApi = resource('/timetable');
export const examsApi = resource('/exams');
export const departmentsApi = resource('/departments');

export const assignmentsApi = {
  ...resource('/assignments'),
  mine: (params) => http.get('/assignments/mine', params),
  submit: (id, body) => http.post(`/assignments/${id}/submit`, body),
  withdraw: (id) => http.del(`/assignments/${id}/submit`),
  submissions: (id) => http.get(`/assignments/${id}/submissions`),
};

export const marksApi = { ...resource('/marks'), mine: (params) => http.get('/marks/mine', params) };

export const attendanceApi = {
  history: (params) => http.get('/attendance', params),
  summary: () => http.get('/attendance/summary'),
  myAttendance: (params) => http.get('/attendance/me', params),
  roster: (params) => http.get('/attendance/roster', params),
  submit: (body) => http.post('/attendance', body),
  update: (id, body) => http.put(`/attendance/${id}`, body),
  remove: (id, body) => http.del(`/attendance/${id}`, body),
};

export const announcementsApi = resource('/announcements');

/* Google Sheets has no boolean type: booleans arrive as "TRUE"/"FALSE" strings. */
const toBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'y';
};

const withReadFlag = (rows) => (rows || []).map((n) => ({ ...n, isRead: toBool(n.isRead) }));

export const notificationsApi = {
  list: async (params) => {
    const res = await http.get('/notifications', params);
    return { ...res, data: withReadFlag(res.data), unreadCount: res.unreadCount ?? withReadFlag(res.data).filter((n) => !n.isRead).length };
  },
  markRead: (id) => http.put(`/notifications/${id}/read`),
  markAllRead: () => http.put('/notifications/read-all'),
  recipients: (params) => http.get('/notifications/recipients', params),
  send: (body) => http.post('/notifications', body),
};

export const usersApi = {
  list: (params) => http.get('/users', params),
  create: (body) => http.post('/users', body),
  update: (id, body) => http.put(`/users/${id}`, body),
  remove: (id, body) => http.del(`/users/${id}`, body),
  globalSearch: (q) => http.get('/users/search/global', { q }),
};

/* ------------------------------------------------------------------ reports */

/** Human-readable header for a report column key. */
export const reportColumnLabel = (column) =>
  String(column)
    .replace(/([A-Z])/g, ' $1')
    .replace(/Id$/, '')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();

/**
 * Downloads a report as CSV.
 *
 * Uses fetch + a Blob instead of axios so the browser's own download UI is used.
 * A blob is also required because the response carries a Content-Disposition
 * header plus a UTF-8 BOM for Excel, which axios would treat as a normal payload.
 */
const downloadCsv = async (report, params) => {
  const query = new URLSearchParams(
    Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 'all')
  ).toString();
  const token = tokenStore.get();
  const response = await fetch(
    `${api.defaults.baseURL}/reports/${report}/download${query ? `?${query}` : ''}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );

  if (!response.ok) {
    let message = 'The report could not be downloaded.';
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      // Non-JSON error body (e.g. a gateway page); keep the default message.
    }
    throw new ApiError(message, response.status, null);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = match ? match[1] : `${report}.csv`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { fileName };
};

export const reportsApi = {
  /** Catalogue of reports the current role may run. */
  catalogue: () => http.get('/reports'),
  /** Preview rows (already department scoped + filtered server-side). */
  preview: (report, params) => http.get(`/reports/${report}`, params),
  download: (report, params) => downloadCsv(report, params),
};

export default api;