/**
 * FR-ENT-02: normalise number plates before storing or comparing.
 * - display form: trimmed, single spaces, uniform separators ("-"), upper-cased words
 * - comparison key: letters and digits only, upper-case
 * "  sylhet metro ga 11 2345 " and "Sylhet Metro-Ga 11-2345" share the key SYLHETMETROGA112345.
 */
function displayPlate(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s*[-_/.]+\s*/g, '-')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function plateKey(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9ঀ-৿]/g, '');
}

function isValidPlate(raw) {
  const key = plateKey(raw);
  return key.length >= 4 && key.length <= 30 && /\d/.test(key);
}

module.exports = { displayPlate, plateKey, isValidPlate };
