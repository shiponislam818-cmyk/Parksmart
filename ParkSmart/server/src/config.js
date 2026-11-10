const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name} (see server/.env.example)`);
  return v;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  // NFR-SEC-02: at most 8 hours (one gate shift)
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  bcryptCost: Math.max(10, Number(process.env.BCRYPT_COST || 10)),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'ParkSmart <no-reply@parksmart.local>',
  },
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 20000),
};

module.exports = config;
