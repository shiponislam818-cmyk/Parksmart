class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const badRequest = (msg, extra) => new AppError(400, msg, extra);
const unauthorized = (msg = 'Please log in to continue.') => new AppError(401, msg);
const forbidden = (msg = 'Your role is not allowed to do this. Ask an administrator if you need access.') => new AppError(403, msg);
const notFound = (msg) => new AppError(404, msg);
const conflict = (msg, extra) => new AppError(409, msg, extra);

/** Wrap async route handlers so rejected promises reach the error middleware. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, ah };
