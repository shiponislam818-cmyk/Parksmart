const { Pool, types } = require('pg');
const config = require('../config');

// Return NUMERIC as JS numbers (amounts are small, 2 decimals) and BIGINT counts as numbers.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// DATE columns stay as 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

pool.on('error', (err) => console.error('[db] idle client error', err.message));

/** Run fn(client) inside a transaction; commits on success, rolls back on error. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: (text, params) => pool.query(text, params), withTransaction };
