/**
 * ParkSmart fee engine — FR-BIL-02 / FR-BIL-04.
 * A pure function of (entry time, exit time, rate rule): no I/O, no clock reads.
 *
 * Rules:
 *  - duration <= grace minutes            -> fee 0
 *  - otherwise hour 1 costs first_hour, every further *started* hour costs per_hour
 *  - hours are grouped in 24-hour blocks counted from entry; each block is capped at daily_cap
 *  - optional lost-ticket penalty is added on top (OI-2: penalty adds to the time-based fee)
 */

const MINUTE = 60 * 1000;

function toDate(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new TypeError('Invalid date passed to fee engine');
  return d;
}

function durationMinutes(entryTime, exitTime) {
  const ms = toDate(exitTime).getTime() - toDate(entryTime).getTime();
  if (ms < 0) throw new RangeError('Exit time is before entry time');
  // seconds are rounded up to the next minute so 10:00:30 counts as 1 minute
  return Math.ceil(ms / MINUTE);
}

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * @param {Date|string} entryTime
 * @param {Date|string} exitTime
 * @param {{first_hour:number, per_hour:number, daily_cap:number, grace_minutes:number}} rule
 * @param {{lostTicketPenalty?: number}} [options]
 * @returns {{minutes:number, chargedHours:number, days:number, timeFee:number, penalty:number, total:number, withinGrace:boolean, capApplied:boolean, lines:string[]}}
 */
function calculateFee(entryTime, exitTime, rule, options = {}) {
  if (!rule) throw new TypeError('Rate rule is required');
  const firstHour = Number(rule.first_hour);
  const perHour = Number(rule.per_hour);
  const dailyCap = Number(rule.daily_cap);
  const grace = Number(rule.grace_minutes) || 0;
  const penalty = money(options.lostTicketPenalty || 0);

  const minutes = durationMinutes(entryTime, exitTime);
  const lines = [];

  if (minutes <= grace) {
    lines.push(`Within ${grace}-minute grace period: BDT 0`);
    if (penalty > 0) lines.push(`Lost-ticket penalty: BDT ${penalty}`);
    return { minutes, chargedHours: 0, days: 0, timeFee: 0, penalty, total: penalty, withinGrace: true, capApplied: false, lines };
  }

  const chargedHours = Math.ceil(minutes / 60);
  let timeFee = 0;
  let capApplied = false;
  const blocks = Math.ceil(chargedHours / 24);

  for (let b = 0; b < blocks; b++) {
    const hoursInBlock = Math.min(24, chargedHours - b * 24);
    let blockFee = b === 0 ? firstHour + perHour * (hoursInBlock - 1) : perHour * hoursInBlock;
    const label = b === 0
      ? (hoursInBlock === 1 ? 'First hour' : `First hour ${firstHour} + ${hoursInBlock - 1} x ${perHour}`)
      : `Day ${b + 1}: ${hoursInBlock} x ${perHour}`;
    if (dailyCap > 0 && blockFee > dailyCap) {
      blockFee = dailyCap;
      capApplied = true;
      lines.push(`${b === 0 ? 'Day 1' : `Day ${b + 1}`}: daily cap BDT ${money(dailyCap)}`);
    } else {
      lines.push(`${label}: BDT ${money(blockFee)}`);
    }
    timeFee += blockFee;
  }

  timeFee = money(timeFee);
  if (penalty > 0) lines.push(`Lost-ticket penalty: BDT ${penalty}`);
  return {
    minutes,
    chargedHours,
    days: blocks,
    timeFee,
    penalty,
    total: money(timeFee + penalty),
    withinGrace: false,
    capApplied,
    lines,
  };
}

function formatDuration(minutes) {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `${d ? `${d} d ` : ''}${h} h ${m} m`;
}

module.exports = { calculateFee, durationMinutes, formatDuration };
