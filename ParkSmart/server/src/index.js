const http = require('http');
const config = require('./config');
const { createApp } = require('./app');
const { initRealtime } = require('./realtime');
const { startScheduler } = require('./services/scheduler');
const { pool } = require('./db/pool');

async function main() {
  try {
    await pool.query('SELECT 1 FROM users LIMIT 1');
  } catch (e) {
    console.error(`\n[ParkSmart] Cannot use the database: ${e.message}\nCheck DATABASE_URL in server/.env and run "npm run db:setup".\n`);
    process.exit(1);
  }
  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);
  server.listen(config.port, () => {
    console.log(`[ParkSmart] API listening on http://localhost:${config.port}/api/v1`);
  });
  startScheduler();
}

main();
