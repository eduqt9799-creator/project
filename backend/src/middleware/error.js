const env = require('../config/env');

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details || null;
  }
}

const notFound = (message = 'Resource not found') => new ApiError(404, message);
const badRequest = (message = 'Invalid request', details) => new ApiError(400, message, details);
const forbidden = (message = 'You do not have permission to access this resource') => new ApiError(403, message);

/**
 * Centralised error handler.
 * Never leaks stack traces or internal messages to the client in production.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (error, req, res, next) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ success: false, message: error.message, ...(error.details ? { errors: error.details } : {}) });
  }
  const status = error && error.status ? error.status : 500;
  if (!env.isProduction) {
    // eslint-disable-next-line no-console
    console.error('[error]', error);
  }
  const message =
    status === 502
      ? error.message || 'The data store is currently unavailable. Please try again shortly.'
      : status >= 500
        ? 'Something went wrong while processing your request.'
        : error.message || 'Invalid request';
  return res.status(status).json({ success: false, message });
};

const notFoundHandler = (req, res) => {
  res.status(404).json({ success: false, message: `No route matches ${req.method} ${req.originalUrl}` });
};

/** Wraps async route handlers so rejected promises reach the error handler. */
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

module.exports = { ApiError, errorHandler, notFoundHandler, asyncHandler, notFound, badRequest, forbidden };