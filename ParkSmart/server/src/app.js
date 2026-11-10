const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { AppError } = require('./utils/errors');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json({ limit: '200kb' }));

  // CI-03: versioned API
  const api = express.Router();
  api.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  api.use('/guest', require('./routes/guest')); // public — must be mounted before authenticated routers
  api.use('/auth', require('./routes/auth'));
  api.use('/users', require('./routes/users'));
  api.use('/sessions', require('./routes/sessions'));
  api.use('/payments', require('./routes/payments'));
  api.use('/me', require('./routes/driver'));
  api.use('/reports', require('./routes/reports'));
  api.use('/audit', require('./routes/audit'));
  // routers mounted at the root (facilities, zones, slots, availability, rates, settings) come last
  api.use('/', require('./routes/facilities'));
  api.use('/', require('./routes/rates'));
  api.use((req, res) => res.status(404).json({ error: `No API route ${req.method} ${req.originalUrl}.` }));
  app.use('/api/v1', api);

  // Production: serve the built React client from the same origin
  const dist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // error handler: every error states what went wrong and what to do (UI-07)
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (err.code === '22P02') return res.status(400).json({ error: 'One of the values has the wrong format. Check the form and try again.' });
    console.error('[error]', err);
    res.status(500).json({ error: 'Something went wrong on the server. Try again; if it keeps happening, contact the administrator.' });
  });
  return app;
}

module.exports = { createApp };
