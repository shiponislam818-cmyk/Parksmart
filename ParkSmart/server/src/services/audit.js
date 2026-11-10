const db = require('../db/pool');

/**
 * FR-REP-05: append an audit entry. Pass a transaction client so the audit row commits
 * (or rolls back) together with the action it describes.
 */
async function audit(clientOrNull, { userId = null, action, target = null, details = null }) {
  const runner = clientOrNull || db;
  await runner.query(
    'INSERT INTO audit_log (user_id, action, target, details) VALUES ($1, $2, $3, $4)',
    [userId, action, target, details ? JSON.stringify(details) : null]
  );
}

module.exports = { audit };
