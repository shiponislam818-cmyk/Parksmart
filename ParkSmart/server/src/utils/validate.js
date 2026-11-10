const { badRequest } = require('./errors');

const VEHICLE_TYPES = ['motorcycle', 'car', 'microbus'];
const VEHICLE_LABELS = { motorcycle: 'Motorcycle', car: 'Car / CNG', microbus: 'Microbus / SUV' };

/**
 * Minimal schema validator. Each field spec:
 * { type: 'string'|'int'|'number'|'bool'|'date'|'email', required, min, max, enum, trim, default, label }
 * Returns a clean object containing only declared fields.
 */
function validate(input, schema) {
  const out = {};
  const src = input || {};
  for (const [key, spec] of Object.entries(schema)) {
    const label = spec.label || key.replace(/_/g, ' ');
    let v = src[key];
    if (typeof v === 'string' && spec.type !== 'password') v = v.trim();
    if (v === undefined || v === null || v === '') {
      if (spec.required) throw badRequest(`${cap(label)} is required.`);
      if (spec.default !== undefined) out[key] = spec.default;
      continue;
    }
    switch (spec.type) {
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n)) throw badRequest(`${cap(label)} must be a whole number.`);
        checkRange(n, spec, label);
        v = n;
        break;
      }
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw badRequest(`${cap(label)} must be a number.`);
        checkRange(n, spec, label);
        v = Math.round(n * 100) / 100;
        break;
      }
      case 'bool':
        v = v === true || v === 'true' || v === 1 || v === '1';
        break;
      case 'date': {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) throw badRequest(`${cap(label)} is not a valid date/time.`);
        v = d;
        break;
      }
      case 'email':
        v = String(v).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw badRequest('Enter a valid email address, e.g. name@example.com.');
        break;
      case 'phone':
        v = String(v).replace(/[\s-]/g, '');
        if (!/^\+?\d{10,14}$/.test(v)) throw badRequest('Enter a valid phone number, e.g. 01712345678.');
        break;
      case 'password':
        v = String(v);
        if (v.length < 8) throw badRequest('Password must be at least 8 characters.');
        if (v.length > 72) throw badRequest('Password must be at most 72 characters.');
        break;
      default: {
        v = String(v);
        if (spec.min && v.length < spec.min) throw badRequest(`${cap(label)} must be at least ${spec.min} characters.`);
        if (spec.max && v.length > spec.max) throw badRequest(`${cap(label)} must be at most ${spec.max} characters.`);
      }
    }
    if (spec.enum && !spec.enum.includes(v)) throw badRequest(`${cap(label)} must be one of: ${spec.enum.join(', ')}.`);
    out[key] = v;
  }
  return out;
}

function checkRange(n, spec, label) {
  if (spec.min !== undefined && n < spec.min) throw badRequest(`${cap(label)} must be at least ${spec.min}.`);
  if (spec.max !== undefined && n > spec.max) throw badRequest(`${cap(label)} must be at most ${spec.max}.`);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { validate, VEHICLE_TYPES, VEHICLE_LABELS };
