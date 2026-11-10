const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFee, durationMinutes, formatDuration } = require('../../src/services/feeEngine');

// SRS worked example: car BDT 30 first hour, BDT 20 per started hour, grace 10 min
const car = { first_hour: 30, per_hour: 20, daily_cap: 300, grace_minutes: 10 };
const at = (h, m = 0, day = 1) => new Date(Date.UTC(2026, 10, day, h, m));

test('SRS worked example: 3 h 25 m costs BDT 90', () => {
  const r = calculateFee(at(4, 15), at(7, 40), car);
  assert.equal(r.minutes, 205);
  assert.equal(r.chargedHours, 4);
  assert.equal(r.total, 90);
});

test('SRS worked example: 8 minutes is within grace -> BDT 0', () => {
  const r = calculateFee(at(10, 0), at(10, 8), car);
  assert.equal(r.total, 0);
  assert.equal(r.withinGrace, true);
});

test('exactly the grace period is free, one minute more is charged the first hour', () => {
  assert.equal(calculateFee(at(10), at(10, 10), car).total, 0);
  assert.equal(calculateFee(at(10), at(10, 11), car).total, 30);
});

test('exactly 60 minutes is one hour; 61 minutes starts the second hour', () => {
  assert.equal(calculateFee(at(10), at(11), car).total, 30);
  assert.equal(calculateFee(at(10), at(11, 1), car).total, 50);
});

test('daily cap limits a 24-hour block', () => {
  const r = calculateFee(at(8), at(23), car); // 15 h -> 30 + 14*20 = 310 -> capped 300
  assert.equal(r.total, 300);
  assert.equal(r.capApplied, true);
});

test('each 24-hour block is capped separately (multi-day stay)', () => {
  // 26 h: block1 = 24 h capped 300, block2 = 2 h x 20 = 40
  const r = calculateFee(at(8, 0, 1), at(10, 0, 2), car);
  assert.equal(r.chargedHours, 26);
  assert.equal(r.days, 2);
  assert.equal(r.total, 340);
  // 49 h: 300 + 300 + 20
  assert.equal(calculateFee(at(8, 0, 1), at(9, 0, 3), car).total, 620);
});

test('stay across midnight is charged by duration, not calendar day', () => {
  const r = calculateFee(at(23, 30, 1), at(1, 0, 2), car); // 1 h 30 m
  assert.equal(r.total, 50);
});

test('daily cap of 0 means no cap', () => {
  const r = calculateFee(at(0), at(23, 59), { ...car, daily_cap: 0 });
  assert.equal(r.total, 30 + 23 * 20);
});

test('lost-ticket penalty is added to the time fee, also inside grace', () => {
  assert.equal(calculateFee(at(10), at(12), car, { lostTicketPenalty: 200 }).total, 50 + 200);
  const g = calculateFee(at(10), at(10, 5), car, { lostTicketPenalty: 200 });
  assert.equal(g.total, 200);
  assert.equal(g.timeFee, 0);
});

test('accepts ISO strings and rounds partial minutes up', () => {
  assert.equal(durationMinutes('2026-11-01T10:00:00Z', '2026-11-01T10:00:30Z'), 1);
  assert.equal(calculateFee('2026-11-01T10:00:00Z', '2026-11-01T10:10:30Z', car).total, 30);
});

test('rejects invalid input', () => {
  assert.throws(() => calculateFee(at(12), at(10), car), RangeError);
  assert.throws(() => calculateFee('nope', at(10), car), TypeError);
  assert.throws(() => calculateFee(at(10), at(11)), TypeError);
});

test('breakdown lines explain the fee', () => {
  const r = calculateFee(at(4, 15), at(7, 40), car);
  assert.ok(r.lines[0].includes('First hour 30 + 3 x 20'));
  assert.equal(calculateFee(at(10), at(10, 30), car).lines[0], 'First hour: BDT 30');
});

test('formatDuration', () => {
  assert.equal(formatDuration(205), '3 h 25 m');
  assert.equal(formatDuration(1500), '1 d 1 h 0 m');
});
