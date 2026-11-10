// UI-06: amounts as "BDT 1,250", dates DD/MM/YYYY, 12-hour time, shown in Asia/Dhaka (C-5)
const TZ = 'Asia/Dhaka';

export const VEHICLE_LABELS = { car: 'Car / CNG', motorcycle: 'Motorcycle', microbus: 'Microbus / SUV' };
export const VEHICLE_ORDER = ['motorcycle', 'car', 'microbus'];
export const STATUS_LABELS = { free: 'Free', occupied: 'Occupied', reserved: 'Reserved', out_of_service: 'Out of Service' };
export const METHOD_LABELS = { cash: 'Cash', online: 'Online (sandbox)', pass: 'Monthly pass' };
export const ROLE_LABELS = { admin: 'Administrator', operator: 'Gate Operator', driver: 'Registered Driver' };

export function bdt(n) {
  const v = Number(n || 0);
  return `BDT ${v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function parts(d) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(d));
  const get = (t) => (p.find((x) => x.type === t) || {}).value;
  return { day: get('day'), month: get('month'), year: get('year'), hour: get('hour'), minute: get('minute'), ampm: (get('dayPeriod') || '').toUpperCase() };
}

export function fmtDateTime(d) {
  if (!d) return '—';
  const p = parts(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute} ${p.ampm}`;
}
export function fmtTime(d) {
  if (!d) return '—';
  const p = parts(d);
  return `${p.hour}:${p.minute} ${p.ampm}`;
}
export function fmtDate(d) {
  if (!d) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
    const [y, m, dd] = String(d).split('-');
    return `${dd}/${m}/${y}`;
  }
  const p = parts(d);
  return `${p.day}/${p.month}/${p.year}`;
}
export function fmtMinutes(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return `${d ? `${d} d ` : ''}${h} h ${m % 60} m`;
}
export function hourLabel(h) {
  return `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Today's date in Dhaka as YYYY-MM-DD */
export function dhakaToday(offsetDays = 0) {
  return new Date(Date.now() + 6 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** Value for <input type="datetime-local"> in Dhaka time, from a Date */
export function toDhakaInput(date) {
  return new Date(date.getTime() + 6 * 3600000).toISOString().slice(0, 16);
}
/** Parse a datetime-local value as Dhaka time -> ISO string */
export function fromDhakaInput(v) {
  if (!v) return null;
  return new Date(`${v}:00+06:00`).toISOString();
}
