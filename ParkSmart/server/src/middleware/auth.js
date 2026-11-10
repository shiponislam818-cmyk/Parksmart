const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/pool');
const { unauthorized, forbidden } = require('../utils/errors');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Verifies the Bearer JWT and re-checks the account is still active (server-side, NFR-SEC-05). */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch (e) {
      throw unauthorized(e.name === 'TokenExpiredError' ? 'Your session has expired. Please log in again.' : 'Invalid login token. Please log in again.');
    }
    const { rows } = await db.query('SELECT id, name, email, phone, role, is_active FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user || !user.is_active) throw unauthorized('This account is deactivated. Contact an administrator.');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** FR-AUTH-05: restrict a route to the roles in the permission matrix (Section 3.9). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

module.exports = { signToken, authenticate, requireRole };
