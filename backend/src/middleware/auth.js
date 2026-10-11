const jwt = require('jsonwebtoken');
const env = require('../config/env');
const dataService = require('../services/dataService');
const { SINGLE_DEPARTMENT } = require('../config/department');

const ROLE_PRIORITY = ['student', 'faculty', 'hod', 'admin'];

const signToken = (user) =>
  jwt.sign(
    {
      sub: user.userId,
      role: user.role,
      departmentId: user.departmentId || '',
      email: user.email,
    },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );

const readBearerToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  if (req.query && typeof req.query.token === 'string') return req.query.token;
  return null;
};

/**
 * Validates the JWT, re-reads the user from the backend data store (Google Sheets)
 * so that role / department / status can never be trusted from the client.
 */
const authenticateUser = async (req, res, next) => {
  try {
    const token = readBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch (error) {
      const message = error.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid session token.';
      return res.status(401).json({ success: false, message });
    }

    // Read through dataService so the shared 30s cache is used: this runs on
    // every authenticated request and a direct Apps Script read here added
    // 6-20s to every page load.
    const users = await dataService.users();
    const user = (Array.isArray(users) ? users : []).find(
      (u) => String(u.userId) === String(payload.sub) || String(u.email || '').toLowerCase() === String(payload.email || '').toLowerCase()
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'Account no longer exists. Please contact the administrator.' });
    }
    if (String(user.status || 'active').toLowerCase() !== 'active') {
      return res.status(403).json({ success: false, message: 'This account is deactivated.' });
    }

    const role = String(user.role || '').toLowerCase();
    // The deployment serves one department, so a non-admin session is always
    // scoped to it; this keeps reads, writes and bridge actor checks consistent
    // even before the sheet migration has rewritten a legacy department value.
    req.user = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      role,
      departmentId: role === 'admin' ? '' : SINGLE_DEPARTMENT.departmentId,
      departmentName: role === 'admin' ? '' : SINGLE_DEPARTMENT.departmentName,
      status: user.status || 'active',
      profile: user,
    };

    if (!ROLE_PRIORITY.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Account role is not recognised.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
  const allowed = roles.map((r) => String(r).toLowerCase());
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
  }
  return next();
};

const requireDepartmentAccess = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
  if (req.user.role === 'admin') return next();
  if (req.user.departmentId) return next();
  return res.status(403).json({ success: false, message: 'No department is assigned to this account.' });
};

/**
 * Resolves the effective department for a request.
 * Admin may target any department; every other role is pinned to its own department.
 */
const resolveDepartmentId = (req, requestedDepartmentId) => {
  if (req.user.role === 'admin') return requestedDepartmentId || '';
  return req.user.departmentId || '';
};

/**
 * The authenticated identity, forwarded to Apps Script so the bridge can
 * re-check department authority before it writes. Derived from the verified
 * session only — never from anything the client sent.
 */
const actorOf = (req) =>
  req && req.user
    ? { userId: req.user.userId, role: req.user.role, departmentId: req.user.departmentId || '' }
    : null;

module.exports = { signToken, authenticateUser, requireRole, requireDepartmentAccess, resolveDepartmentId, actorOf, ROLE_PRIORITY };