/**
 * End-to-end API tests against a real PostgreSQL database.
 * Requires TEST_DATABASE_URL (a throw-away database — it is RESET by this test).
 *   PowerShell:  $env:TEST_DATABASE_URL="postgres://postgres:pw@localhost:5432/parksmart_test"; npm run test:integration
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  test('integration tests skipped (set TEST_DATABASE_URL)', { skip: true }, () => {});
  return;
}
process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.SCHEDULER_INTERVAL_MS = '600000';

execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'src', 'db', 'setup.js'), '--reset'], {
  env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'ignore',
});

const { createApp } = require('../../src/app');
const { initRealtime } = require('../../src/realtime');
const db = require('../../src/db/pool');
const scheduler = require('../../src/services/scheduler');
const { io: ioClient } = require('socket.io-client');

let server;
let base;
const tokens = {};

async function call(method, url, { token, body } = {}) {
  const res = await fetch(`${base}/api/v1${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, type };
}
const login = async (identifier, password) => (await call('POST', '/auth/login', { body: { identifier, password } })).data.token;
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

test.before(async () => {
  server = http.createServer(createApp());
  initRealtime(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
  tokens.admin = await login('admin@parksmart.local', 'Admin@1234');
  tokens.op = await login('operator@parksmart.local', 'Operator@1234');
  tokens.driver = await login('01700000003', 'Driver@1234'); // login by phone
});

test.after(async () => {
  scheduler.stopScheduler();
  await new Promise((r) => server.close(r));
  await db.pool.end();
  setTimeout(() => process.exit(0), 100).unref();
});

test('auth: register, duplicate, wrong password lockout, change password', async () => {
  const reg = await call('POST', '/auth/register', { body: { name: 'Test Driver', phone: '01811111111', email: 'td@example.com', password: 'secret123' } });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'driver');
  const dup = await call('POST', '/auth/register', { body: { name: 'Xavier', phone: '01811111111', email: 'other@example.com', password: 'secret123' } });
  assert.equal(dup.status, 409);
  const bad = await call('POST', '/auth/register', { body: { name: 'X', phone: '12', email: 'bad', password: 'x' } });
  assert.equal(bad.status, 400);

  for (let i = 0; i < 4; i++) {
    const r = await call('POST', '/auth/login', { body: { identifier: 'td@example.com', password: 'wrong' } });
    assert.equal(r.status, 401);
  }
  const fifth = await call('POST', '/auth/login', { body: { identifier: 'td@example.com', password: 'wrong' } });
  assert.match(fifth.data.error, /locked for 15 minutes/);
  const locked = await call('POST', '/auth/login', { body: { identifier: 'td@example.com', password: 'secret123' } });
  assert.equal(locked.status, 401);
  assert.match(locked.data.error, /locked/i);
  await db.query(`UPDATE users SET locked_until = NULL WHERE email = 'td@example.com'`);

  const t = await login('td@example.com', 'secret123');
  const wrongCur = await call('POST', '/auth/change-password', { token: t, body: { current_password: 'nope', new_password: 'newsecret1' } });
  assert.equal(wrongCur.status, 400);
  const ok = await call('POST', '/auth/change-password', { token: t, body: { current_password: 'secret123', new_password: 'newsecret1' } });
  assert.equal(ok.status, 200);
  assert.ok(await login('td@example.com', 'newsecret1'));
  // bcrypt hash, never plain text (FR-AUTH-03)
  const h = (await db.query(`SELECT password_hash FROM users WHERE email = 'td@example.com'`)).rows[0].password_hash;
  assert.match(h, /^\$2[aby]\$10\$/);
});

test('RBAC matrix enforced server-side (NFR-SEC-05)', async () => {
  assert.equal((await call('GET', '/facilities')).status, 401);
  assert.equal((await call('POST', '/sessions', { token: tokens.driver, body: {} })).status, 403);
  assert.equal((await call('GET', '/reports/dashboard', { token: tokens.op })).status, 403);
  assert.equal((await call('PUT', '/rates/car', { token: tokens.op, body: {} })).status, 403);
  assert.equal((await call('GET', '/users', { token: tokens.op })).status, 403);
  assert.equal((await call('GET', '/audit', { token: tokens.driver })).status, 403);
  assert.equal((await call('POST', '/facilities', { token: tokens.op, body: { name: 'X' } })).status, 403);
  assert.equal((await call('GET', '/me/vehicles', { token: tokens.admin })).status, 403);
  assert.equal((await call('GET', '/availability', { token: tokens.driver })).status, 200);
  assert.equal((await call('PATCH', '/slots/1/service', { token: tokens.driver, body: { out_of_service: true } })).status, 403);
  assert.equal((await call('GET', '/sessions', { token: 'garbage' })).status, 401);
});

test('admin: staff accounts create / edit / deactivate (FR-AUTH-06)', async () => {
  const c = await call('POST', '/users', { token: tokens.admin, body: { name: 'Gate Two', email: 'gate2@parksmart.local', role: 'operator', password: 'Gate2pass!' } });
  assert.equal(c.status, 201);
  const t = await login('gate2@parksmart.local', 'Gate2pass!');
  assert.ok(t);
  const e = await call('PUT', `/users/${c.data.id}`, { token: tokens.admin, body: { name: 'Gate Two B', email: 'gate2@parksmart.local', role: 'operator' } });
  assert.equal(e.data.name, 'Gate Two B');
  await call('PATCH', `/users/${c.data.id}/active`, { token: tokens.admin, body: { is_active: false } });
  assert.equal((await call('GET', '/sessions', { token: t })).status, 401); // existing token rejected immediately
  assert.equal((await call('POST', '/auth/login', { body: { identifier: 'gate2@parksmart.local', password: 'Gate2pass!' } })).status, 401);
  await call('PATCH', `/users/${c.data.id}/active`, { token: tokens.admin, body: { is_active: true } });
  assert.ok(await login('gate2@parksmart.local', 'Gate2pass!'));
  const self = await call('PATCH', '/users/1/active', { token: tokens.admin, body: { is_active: false } });
  assert.equal(self.status, 400);
});

test('entry: nearest slot, normalised duplicate check, override, idempotent retry', async () => {
  const sug = await call('GET', '/sessions/suggest?facility_id=1&vehicle_type=car', { token: tokens.op });
  assert.equal(sug.data.slot.code, 'A-01');
  const e1 = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Dhaka Metro-Kha 12-3456', vehicle_type: 'car', client_request_id: 'req-1' } });
  assert.equal(e1.status, 201);
  assert.equal(e1.data.slot, 'A-01');
  assert.match(e1.data.qr, /^data:image\/png;base64,/);
  assert.match(e1.data.ticket_code, /^PS-/);
  // retry with same request id returns the same ticket, no duplicate (NFR-REL-03)
  const retry = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Dhaka Metro-Kha 12-3456', vehicle_type: 'car', client_request_id: 'req-1' } });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.ticket_code, e1.data.ticket_code);
  // same plate typed differently, even at another facility -> refused with location (FR-ENT-03)
  const dup = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 2, plate: ' dhaka metro kha 12 3456 ', vehicle_type: 'car' } });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /already parked at City Centre Mall, Level 1, slot A-01/);
  // next entry gets A-02
  const e2 = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Dhaka Metro-Kha 12-0002', vehicle_type: 'car' } });
  assert.equal(e2.data.slot, 'A-02');
  // operator override to a chosen free slot (FR-ENT-05)
  const free = await call('GET', '/facilities/1/slots?status=free&vehicle_type=car', { token: tokens.op });
  const b5 = free.data.find((s) => s.code === 'B-05');
  const e3 = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Dhaka Metro-Kha 12-0003', vehicle_type: 'car', slot_id: b5.id } });
  assert.equal(e3.data.slot, 'B-05');
  const moto = (await call('GET', '/facilities/1/slots?vehicle_type=motorcycle', { token: tokens.op })).data[0];
  const mism = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Dhaka Metro-Kha 12-0004', vehicle_type: 'car', slot_id: moto.id } });
  assert.equal(mism.status, 409);
  const occ = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Dhaka Metro-Kha 12-0004', vehicle_type: 'car', slot_id: b5.id } });
  assert.equal(occ.status, 409);
  const badPlate = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'xx', vehicle_type: 'car' } });
  assert.equal(badPlate.status, 400);
});

test('entry: concurrent gates never share a slot; full facility is refused (FR-ENT-07/08)', async () => {
  const f = await call('POST', '/facilities', { token: tokens.admin, body: { name: 'Tiny Lot', address: 'Test', opening_hours: '24 hours' } });
  const z = await call('POST', `/facilities/${f.data.id}/zones`, { token: tokens.admin, body: { label: 'Only', sort_order: 1 } });
  const s = await call('POST', `/zones/${z.data.id}/slots`, { token: tokens.admin, body: { mode: 'bulk', prefix: 'T-', from: 1, to: 5, vehicle_type: 'car' } });
  assert.equal(s.data.length, 5);
  const dupCodes = await call('POST', `/zones/${z.data.id}/slots`, { token: tokens.admin, body: { code: 't-03', vehicle_type: 'car' } });
  assert.equal(dupCodes.status, 409);

  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call('POST', '/sessions', {
    token: i % 2 ? tokens.op : tokens.admin, body: { facility_id: f.data.id, plate: `Sylhet Ha 99-${1000 + i}`, vehicle_type: 'car' },
  })));
  const ok = results.filter((r) => r.status === 201);
  const full = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 5);
  assert.equal(full.length, 5);
  assert.equal(new Set(ok.map((r) => r.data.slot)).size, 5);
  assert.match(full[0].data.error, /Facility full for Car \/ CNG/);
  // FR-SLOT-08: cannot delete an occupied slot or its zone
  const del = await call('DELETE', `/slots/${s.data[0].id}`, { token: tokens.admin });
  assert.equal(del.status, 409);
  assert.equal((await call('DELETE', `/zones/${z.data.id}`, { token: tokens.admin })).status, 409);
  const fac = await call('PATCH', `/facilities/${f.data.id}/active`, { token: tokens.admin, body: { is_active: false } });
  assert.equal(fac.status, 409);
});

test('exit: fee from entry-time rule, cash payment closes session and frees slot', async () => {
  const e = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Sylhet Metro-Ga 11-7777', vehicle_type: 'car' } });
  await db.query('UPDATE parking_sessions SET entry_time = $2 WHERE id = $1', [e.data.session_id, ago(205)]);
  // rate change after entry must not affect this vehicle (FR-BIL-03)
  const rc = await call('PUT', '/rates/car', { token: tokens.admin, body: { first_hour: 50, per_hour: 40, daily_cap: 500, grace_minutes: 10, lost_ticket_penalty: 200, monthly_pass_price: 3000 } });
  assert.equal(rc.status, 200);
  const look = await call('GET', `/sessions/lookup?code=${encodeURIComponent(e.data.guest_url)}`, { token: tokens.op });
  assert.equal(look.status, 200);
  assert.equal(look.data.quote.total, 90); // 30 + 3 x 20 (old rule)
  const pay = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.op, body: { method: 'cash' } });
  assert.equal(pay.status, 200);
  assert.equal(pay.data.payment.status, 'paid');
  assert.equal(pay.data.payment.amount, 90);
  assert.match(pay.data.payment.receipt_no, /^R-\d{8}-\d+$/);
  const slot = (await db.query('SELECT status FROM slots WHERE code = $1 AND facility_id = 1', [e.data.slot])).rows[0];
  assert.equal(slot.status, 'free');
  const again = await call('GET', `/sessions/lookup?code=${e.data.ticket_code}`, { token: tokens.op });
  assert.equal(again.status, 409);
  assert.equal((await call('GET', '/sessions/lookup?code=PS-00000-00000-00000-00000-000000', { token: tokens.op })).status, 404);
  const receipt = await call('GET', `/payments/${pay.data.payment.id}/receipt`, { token: tokens.op });
  assert.equal(receipt.data.session.plate, 'SYLHET METRO-GA 11-7777');
  assert.ok(receipt.data.breakdown.length > 0);
  const pdf = await call('GET', `/payments/${pay.data.payment.id}/receipt.pdf`, { token: tokens.op });
  assert.equal(pdf.type, 'application/pdf');
  // restore sample car rate
  await call('PUT', '/rates/car', { token: tokens.admin, body: { first_hour: 30, per_hour: 20, daily_cap: 300, grace_minutes: 10, lost_ticket_penalty: 200, monthly_pass_price: 3000 } });
});

test('exit: failed online payment keeps slot occupied; success closes (FR-BIL-09)', async () => {
  const e = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Sylhet Metro-Ga 11-8888', vehicle_type: 'car' } });
  await db.query('UPDATE parking_sessions SET entry_time = $2 WHERE id = $1', [e.data.session_id, ago(70)]);
  const init = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.op, body: { method: 'online' } });
  assert.equal(init.data.pending, true);
  assert.equal(init.data.payment.amount, 50);
  const fail = await call('POST', `/payments/${init.data.payment.id}/sandbox`, { token: tokens.op, body: { outcome: 'failure' } });
  assert.equal(fail.data.payment.status, 'failed');
  let slot = (await db.query('SELECT status FROM slots WHERE id = $1', [e.data.slot_id])).rows[0];
  assert.equal(slot.status, 'occupied');
  assert.equal((await call('POST', `/payments/${init.data.payment.id}/sandbox`, { token: tokens.op, body: { outcome: 'success' } })).status, 409);
  const retry = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.op, body: { method: 'online' } });
  const ok = await call('POST', `/payments/${retry.data.payment.id}/sandbox`, { token: tokens.op, body: { outcome: 'success' } });
  assert.equal(ok.data.payment.status, 'paid');
  slot = (await db.query('SELECT status FROM slots WHERE id = $1', [e.data.slot_id])).rows[0];
  assert.equal(slot.status, 'free');
});

test('lost ticket adds penalty; fee override is admin-only with reason (FR-BIL-06/07)', async () => {
  const e = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Sylhet Metro-Ga 11-5555', vehicle_type: 'car' } });
  await db.query('UPDATE parking_sessions SET entry_time = $2 WHERE id = $1', [e.data.session_id, ago(30)]);
  const look = await call('GET', `/sessions/lookup?plate=${encodeURIComponent('sylhet metro ga 11 5555')}`, { token: tokens.op });
  assert.equal(look.data.quote.total, 30 + 200);
  assert.equal(look.data.quote.lost_ticket, true);
  const opOverride = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.op, body: { method: 'cash', lost_ticket: true, override_amount: 10, override_reason: 'test' } });
  assert.equal(opOverride.status, 403);
  const noReason = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.admin, body: { method: 'cash', lost_ticket: true, override_amount: 10 } });
  assert.equal(noReason.status, 400);
  const ov = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.admin, body: { method: 'cash', lost_ticket: true, override_amount: 100, override_reason: 'Regular customer, ticket damaged' } });
  assert.equal(ov.data.payment.amount, 100);
  assert.equal(ov.data.payment.original_amount, 230);
  const a = await call('GET', '/audit?action=fee_override', { token: tokens.admin });
  assert.equal(a.data.rows[0].details.reason, 'Regular customer, ticket damaged');
  const s = (await db.query('SELECT is_lost_ticket, fee FROM parking_sessions WHERE id = $1', [e.data.session_id])).rows[0];
  assert.equal(s.is_lost_ticket, true);
  assert.equal(s.fee, 100);
});

test('grace period exit is free', async () => {
  const e = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Sylhet Metro-Ga 11-4444', vehicle_type: 'car' } });
  const look = await call('GET', `/sessions/lookup?code=${e.data.ticket_code}`, { token: tokens.op });
  assert.equal(look.data.quote.total, 0);
  const out = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.op, body: { method: 'cash' } });
  assert.equal(out.data.payment.amount, 0);
});

test('guest ticket page is public, read-only and shows no plate (FR-GST-01/02)', async () => {
  const e = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Sylhet Metro-Ga 11-3333', vehicle_type: 'motorcycle' } });
  const g = await call('GET', `/guest/tickets/${e.data.ticket_code}`);
  assert.equal(g.status, 200);
  assert.equal(g.data.slot, e.data.slot);
  assert.equal(g.data.fee, 0);
  assert.ok(!JSON.stringify(g.data).includes('3333'));
  assert.equal((await call('GET', '/guest/tickets/PS-AAAAA-AAAAA-AAAAA-AAAAA-AAAAAA')).status, 404);
});

test('slot out of service only from Free, with reason (FR-SLOT-07)', async () => {
  const slots = (await call('GET', '/facilities/1/slots?vehicle_type=car', { token: tokens.op })).data;
  const occupied = slots.find((s) => s.status === 'occupied');
  const free = slots.find((s) => s.status === 'free');
  assert.equal((await call('PATCH', `/slots/${occupied.id}/service`, { token: tokens.op, body: { out_of_service: true, reason: 'x' } })).status, 409);
  assert.equal((await call('PATCH', `/slots/${free.id}/service`, { token: tokens.op, body: { out_of_service: true } })).status, 400);
  const oos = await call('PATCH', `/slots/${free.id}/service`, { token: tokens.op, body: { out_of_service: true, reason: 'Pillar repair' } });
  assert.equal(oos.data.status, 'out_of_service');
  const back = await call('PATCH', `/slots/${free.id}/service`, { token: tokens.op, body: { out_of_service: false } });
  assert.equal(back.data.status, 'free');
});

test('reservations: hold at window start, entry uses reserved slot, cancel, expiry (FR-RES-02..05, FR-ENT-06)', async () => {
  const veh = await call('POST', '/me/vehicles', { token: tokens.driver, body: { plate: 'Sylhet Metro-Ka 22-1111', type: 'car' } });
  assert.equal(veh.status, 201);
  // starting now -> active immediately, slot Reserved
  const r = await call('POST', '/me/reservations', { token: tokens.driver, body: { vehicle_id: veh.data.id, facility_id: 2, start_time: new Date().toISOString(), end_time: new Date(Date.now() + 2 * 3600000).toISOString() } });
  assert.equal(r.status, 201);
  const rs = (await db.query('SELECT r.status, s.status AS slot_status, s.id FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = $1', [r.data.id])).rows[0];
  assert.equal(rs.status, 'active');
  assert.equal(rs.slot_status, 'reserved');
  // walk-in does not get the reserved slot
  const walk = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 2, plate: 'Sylhet Ga 10-1010', vehicle_type: 'car' } });
  assert.notEqual(walk.data.slot_id, rs.id);
  // reserved vehicle is placed in its reserved slot
  const ent = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 2, plate: 'sylhet metro ka 22 1111', vehicle_type: 'car' } });
  assert.equal(ent.data.slot_id, rs.id);
  assert.equal(ent.data.via_reservation, true);
  assert.equal((await db.query('SELECT status FROM reservations WHERE id = $1', [r.data.id])).rows[0].status, 'fulfilled');

  // future reservation -> cancel
  const veh2 = await call('POST', '/me/vehicles', { token: tokens.driver, body: { plate: 'Sylhet Metro-Ka 22-2222', type: 'car' } });
  const fut = await call('POST', '/me/reservations', { token: tokens.driver, body: { vehicle_id: veh2.data.id, facility_id: 1, start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 86400000 + 3600000).toISOString() } });
  assert.equal(fut.data.status, 'booked');
  const overlap = await call('POST', '/me/reservations', { token: tokens.driver, body: { vehicle_id: veh2.data.id, facility_id: 1, start_time: new Date(Date.now() + 86400000 + 1800000).toISOString(), end_time: new Date(Date.now() + 86400000 + 7200000).toISOString() } });
  assert.equal(overlap.status, 409);
  assert.equal((await call('POST', `/me/reservations/${fut.data.id}/cancel`, { token: tokens.driver })).status, 200);
  assert.equal((await call('POST', `/me/reservations/${fut.data.id}/cancel`, { token: tokens.driver })).status, 409);
  // validation
  assert.equal((await call('POST', '/me/reservations', { token: tokens.driver, body: { vehicle_id: veh2.data.id, facility_id: 1, start_time: ago(120), end_time: ago(60) } })).status, 400);
  assert.equal((await call('POST', '/me/reservations', { token: tokens.driver, body: { vehicle_id: veh2.data.id, facility_id: 1, start_time: new Date(Date.now() + 3600000).toISOString(), end_time: new Date(Date.now() + 20 * 3600000).toISOString() } })).status, 400);

  // activation by scheduler then expiry after the hold period
  const r3 = await call('POST', '/me/reservations', { token: tokens.driver, body: { vehicle_id: veh2.data.id, facility_id: 1, start_time: new Date(Date.now() + 3600000).toISOString(), end_time: new Date(Date.now() + 7200000).toISOString() } });
  await db.query('UPDATE reservations SET start_time = now() - interval \'1 minute\' WHERE id = $1', [r3.data.id]);
  await scheduler.activateDueReservations();
  let row = (await db.query('SELECT r.status, s.status AS slot_status FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = $1', [r3.data.id])).rows[0];
  assert.equal(row.status, 'active');
  assert.equal(row.slot_status, 'reserved');
  await db.query('UPDATE reservations SET start_time = now() - interval \'20 minutes\' WHERE id = $1', [r3.data.id]);
  await scheduler.expireReservations();
  row = (await db.query('SELECT r.status, s.status AS slot_status FROM reservations r JOIN slots s ON s.id = r.slot_id WHERE r.id = $1', [r3.data.id])).rows[0];
  assert.equal(row.status, 'expired');
  assert.equal(row.slot_status, 'free');
});

test('monthly pass: buy via sandbox, exit costs BDT 0, renewal and reminder (FR-RES-06/07, FR-EXT-05)', async () => {
  const veh = await call('POST', '/me/vehicles', { token: tokens.driver, body: { plate: 'Sylhet Metro-Ka 22-3333', type: 'motorcycle' } });
  const buy = await call('POST', '/me/passes', { token: tokens.driver, body: { vehicle_id: veh.data.id, facility_id: 1 } });
  assert.equal(buy.status, 201);
  assert.equal(buy.data.payment.amount, 800);
  // another driver/operator cannot pay someone else's pass via sandbox
  assert.equal((await call('POST', `/payments/${buy.data.payment.id}/sandbox`, { token: tokens.op, body: { outcome: 'success' } })).status, 403);
  const paid = await call('POST', `/payments/${buy.data.payment.id}/sandbox`, { token: tokens.driver, body: { outcome: 'success' } });
  assert.equal(paid.data.payment.status, 'paid');
  let passes = (await call('GET', '/me/passes', { token: tokens.driver })).data;
  const p = passes.find((x) => x.id === buy.data.pass.id);
  assert.equal(p.status, 'active');

  const e = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 1, plate: 'Sylhet Metro-Ka 22-3333', vehicle_type: 'motorcycle' } });
  await db.query('UPDATE parking_sessions SET entry_time = $2 WHERE id = $1', [e.data.session_id, ago(300)]);
  const look = await call('GET', `/sessions/lookup?code=${e.data.ticket_code}`, { token: tokens.op });
  assert.equal(look.data.quote.total, 0);
  assert.ok(look.data.quote.pass);
  const out = await call('POST', `/sessions/${e.data.session_id}/exit`, { token: tokens.op, body: { method: 'cash' } });
  assert.equal(out.data.payment.method, 'pass');
  assert.equal(out.data.payment.amount, 0);
  const sess = (await db.query('SELECT pass_id FROM parking_sessions WHERE id = $1', [e.data.session_id])).rows[0];
  assert.equal(sess.pass_id, buy.data.pass.id);

  // renewal reminder: make the pass end in 2 days
  await db.query(`UPDATE monthly_passes SET start_date = (now() AT TIME ZONE 'Asia/Dhaka')::date - 27, end_date = (now() AT TIME ZONE 'Asia/Dhaka')::date + 2 WHERE id = $1`, [buy.data.pass.id]);
  passes = (await call('GET', '/me/passes', { token: tokens.driver })).data;
  assert.equal(passes.find((x) => x.id === buy.data.pass.id).renewal_due, true);
  await scheduler.tick();
  assert.equal((await db.query('SELECT reminder_sent FROM monthly_passes WHERE id = $1', [buy.data.pass.id])).rows[0].reminder_sent, true);
  const renew = await call('POST', `/me/passes/${buy.data.pass.id}/renew`, { token: tokens.driver });
  assert.equal(renew.status, 201);
  const startD = new Date(renew.data.pass.start_date);
  const endPrev = (await db.query('SELECT end_date FROM monthly_passes WHERE id = $1', [buy.data.pass.id])).rows[0].end_date;
  assert.equal(startD.getTime() - new Date(endPrev).getTime(), 86400000);
  const fail = await call('POST', `/payments/${renew.data.payment.id}/sandbox`, { token: tokens.driver, body: { outcome: 'failure' } });
  assert.equal(fail.data.payment.status, 'failed');
  assert.equal((await db.query('SELECT status FROM monthly_passes WHERE id = $1', [renew.data.pass.id])).rows[0].status, 'cancelled');

  const hist = await call('GET', '/me/history', { token: tokens.driver });
  assert.ok(hist.data.sessions.length >= 2);
  assert.ok(hist.data.pass_payments.length >= 1);
  const rec = await call('GET', `/payments/${hist.data.pass_payments[0].payment_id}/receipt`, { token: tokens.driver });
  assert.equal(rec.data.kind, 'pass');
  // driver cannot read another person's receipt
  const otherReceipt = (await db.query(`SELECT id FROM payments WHERE status = 'paid' AND session_id IS NOT NULL ORDER BY id LIMIT 1`)).rows[0].id;
  assert.equal((await call('GET', `/payments/${otherReceipt}/receipt`, { token: tokens.driver })).status, 404);
});

test('reports, exports and dashboard (FR-REP-01..04)', async () => {
  const d = await call('GET', '/reports/dashboard', { token: tokens.admin });
  assert.equal(d.status, 200);
  assert.ok(d.data.occupancy.total > 0);
  assert.ok(d.data.entries_today > 0);
  assert.equal(d.data.hourly.length, 24);
  const r = await call('GET', '/reports/revenue?group=day', { token: tokens.admin });
  assert.ok(r.data.totals.amount > 0);
  assert.ok(r.data.totals.by_method.cash > 0);
  for (const g of ['week', 'month']) assert.equal((await call('GET', `/reports/revenue?group=${g}`, { token: tokens.admin })).status, 200);
  const t = await call('GET', '/reports/traffic', { token: tokens.admin });
  assert.ok(t.data.hours.some((h) => h.entries > 0));
  const csv = await call('GET', '/reports/export?report=revenue&format=csv', { token: tokens.admin });
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.data, /Period \(day\)/);
  const pdf = await call('GET', '/reports/export?report=traffic&format=pdf', { token: tokens.admin });
  assert.equal(pdf.type, 'application/pdf');
  assert.equal((await call('GET', '/reports/revenue?from=2026-13-01', { token: tokens.admin })).status, 400);
});

test('audit log is append-only and filterable (FR-REP-05..07)', async () => {
  const all = await call('GET', '/audit', { token: tokens.admin });
  const actions = new Set(all.data.rows.map((a) => a.action));
  for (const a of ['vehicle_entry', 'vehicle_exit', 'payment', 'slot_status_change']) assert.ok(actions.has(a), a);
  const logins = await call('GET', '/audit?action=login&user_id=1', { token: tokens.admin });
  assert.ok(logins.data.rows.every((x) => x.action === 'login' && x.user_id === 1));
  const rate = await call('GET', '/audit?action=rate_change', { token: tokens.admin });
  assert.ok(rate.data.rows[0].details.before);
  await assert.rejects(db.query('UPDATE audit_log SET action = $1', ['x']), /append-only/);
  await assert.rejects(db.query('DELETE FROM audit_log'), /append-only/);
});

test('live slot updates reach every connected client within 2 s (FR-SLOT-06, NFR-PER-02)', async () => {
  const clients = [tokens.op, tokens.admin, tokens.driver].map((t) => ioClient(base, { auth: { token: t }, transports: ['websocket'] }));
  await Promise.all(clients.map((c) => new Promise((r) => c.on('connect', r))));
  const t0 = Date.now();
  const got = Promise.all(clients.map((c) => new Promise((r) => c.once('slot:updated', (s) => r({ s, ms: Date.now() - t0 })))));
  const e = await call('POST', '/sessions', { token: tokens.op, body: { facility_id: 2, plate: 'Sylhet Metro-Ga 55-5555', vehicle_type: 'car' } });
  const res = await got;
  for (const r of res) {
    assert.equal(r.s.id, e.data.slot_id);
    assert.equal(r.s.status, 'occupied');
    assert.ok(r.ms < 2000, `took ${r.ms} ms`);
  }
  const bad = ioClient(base, { auth: { token: 'nope' }, transports: ['websocket'] });
  const err = await new Promise((r) => bad.on('connect_error', r));
  assert.match(err.message, /unauthorized/);
  [...clients, bad].forEach((c) => c.close());
});
