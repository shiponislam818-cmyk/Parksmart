// UI-06 formatting: "BDT 1,250", DD/MM/YYYY, 12-hour time, Asia/Dhaka (C-5)
const TZ = 'Asia/Dhaka';

function bdt(n) {
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

function dateTime(d) {
  if (!d) return '—';
  const p = parts(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute} ${p.ampm}`;
}

function dateOnly(d) {
  if (!d) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
    const [y, m, dd] = String(d).split('-');
    return `${dd}/${m}/${y}`;
  }
  const p = parts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

module.exports = { bdt, dateTime, dateOnly, TZ };
