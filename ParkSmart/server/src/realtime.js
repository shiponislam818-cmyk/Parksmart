const jwt = require('jsonwebtoken');
const config = require('./config');

let io = null;

/** Attach Socket.IO to the HTTP server. Only authenticated staff/drivers may connect. */
function initRealtime(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin: config.clientUrl, credentials: true },
  });
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      socket.user = jwt.verify(token, config.jwtSecret);
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.emit('hello', { at: new Date().toISOString() });
  });
  return io;
}

/** FR-SLOT-06: push a slot-status change to every connected client. */
function emitSlotUpdate(slot) {
  if (!io || !slot) return;
  io.emit('slot:updated', {
    id: slot.id,
    facility_id: slot.facility_id,
    zone_id: slot.zone_id,
    code: slot.code,
    vehicle_type: slot.vehicle_type,
    status: slot.status,
    out_of_service_reason: slot.out_of_service_reason || null,
    at: new Date().toISOString(),
  });
}

/** Tell clients the slot layout changed (slots/zones added or removed) so they re-sync. */
function emitLayoutChanged(facilityId) {
  if (io) io.emit('layout:changed', { facility_id: facilityId });
}

module.exports = { initRealtime, emitSlotUpdate, emitLayoutChanged };
