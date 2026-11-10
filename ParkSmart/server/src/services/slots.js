const db = require('../db/pool');
const { emitSlotUpdate } = require('../realtime');
const { audit } = require('./audit');

const SLOT_SELECT = `
  SELECT s.*, z.label AS zone_label, z.sort_order AS zone_order, f.name AS facility_name
  FROM slots s JOIN zones z ON z.id = s.zone_id JOIN facilities f ON f.id = s.facility_id`;

/**
 * Change a slot's status inside the caller's transaction and record an audit entry.
 * Returns the updated row. The caller must emit after COMMIT (see emitAfter).
 */
async function setSlotStatus(client, slotId, status, { userId = null, reason = null, cause = null } = {}) {
  const { rows } = await client.query(
    `UPDATE slots SET status = $2, out_of_service_reason = $3 WHERE id = $1 RETURNING *`,
    [slotId, status, status === 'out_of_service' ? reason : null]
  );
  const slot = rows[0];
  await audit(client, {
    userId, action: 'slot_status_change', target: `slot:${slotId}`,
    details: { code: slot.code, facility_id: slot.facility_id, status, reason, cause },
  });
  return slot;
}

/** Emit Socket.IO updates for slots once the transaction has committed. */
function emitAfter(slots) {
  for (const s of [].concat(slots).filter(Boolean)) emitSlotUpdate(s);
}

/**
 * FR-ENT-04 / FR-ENT-08: pick and row-lock the nearest suitable Free slot
 * (lowest zone sort_order, then lowest sequence number). SKIP LOCKED lets a parallel
 * gate take the next slot instead of waiting, and the lock guarantees no double assignment.
 */
async function lockNearestFreeSlot(client, facilityId, vehicleType) {
  const { rows } = await client.query(
    `SELECT s.* FROM slots s JOIN zones z ON z.id = s.zone_id
     WHERE s.facility_id = $1 AND s.vehicle_type = $2 AND s.status = 'free'
       AND NOT s.is_deleted AND NOT z.is_deleted
     ORDER BY z.sort_order, z.id, s.sequence_no, s.id
     LIMIT 1
     FOR UPDATE OF s SKIP LOCKED`,
    [facilityId, vehicleType]
  );
  return rows[0] || null;
}

/** Non-locking preview of the slot lockNearestFreeSlot would choose (for the gate UI). */
async function suggestSlot(facilityId, vehicleType) {
  const { rows } = await db.query(
    `${SLOT_SELECT}
     WHERE s.facility_id = $1 AND s.vehicle_type = $2 AND s.status = 'free' AND NOT s.is_deleted AND NOT z.is_deleted
     ORDER BY z.sort_order, z.id, s.sequence_no, s.id LIMIT 1`,
    [facilityId, vehicleType]
  );
  return rows[0] || null;
}

module.exports = { SLOT_SELECT, setSlotStatus, emitAfter, lockNearestFreeSlot, suggestSlot };
