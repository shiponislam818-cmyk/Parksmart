const crypto = require('crypto');

// Crockford base32 alphabet (no I, L, O, U) – easy to read and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * NFR-SEC-04: ticket codes carry 130 random bits (26 base32 chars x 5 bits).
 * Format: PS-XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX
 */
function generateTicketCode() {
  const bytes = crypto.randomBytes(17); // 136 bits, we use 130
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let chars = '';
  for (let i = 0; i < 26; i++) chars += ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return `PS-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20)}`;
}

/**
 * Accepts a typed code, a scanned code, or a scanned guest-page URL (".../t/<code>")
 * and returns the canonical PS-... form, or null if it cannot be a ticket code.
 */
function normaliseTicketInput(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const m = s.match(/\/t\/([^/?#\s]+)/i);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.length === 28 && s.startsWith('PS')) s = s.slice(2);
  // Crockford decoding: tolerate easily confused characters
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 26 || /[^0-9A-HJKMNP-TV-Z]/.test(s)) return null;
  return `PS-${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}-${s.slice(15, 20)}-${s.slice(20)}`;
}

module.exports = { generateTicketCode, normaliseTicketInput };
