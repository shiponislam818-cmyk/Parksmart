const test = require('node:test');
const assert = require('node:assert/strict');
const { displayPlate, plateKey, isValidPlate } = require('../../src/utils/plate');
const { generateTicketCode, normaliseTicketInput } = require('../../src/utils/ticketCode');
const { validate } = require('../../src/utils/validate');
const { bdt, dateTime, dateOnly } = require('../../src/utils/format');

test('plate normalisation: different spellings share one key (FR-ENT-02)', () => {
  const a = plateKey('Sylhet Metro-Ga 11-2345');
  assert.equal(a, 'SYLHETMETROGA112345');
  assert.equal(plateKey('  sylhet metro ga 11 2345 '), a);
  assert.equal(plateKey('SYLHET-METRO-GA-11/2345'), a);
  assert.equal(displayPlate('  sylhet  metro - ga 11 . 2345 '), 'SYLHET METRO-GA 11-2345');
  assert.ok(isValidPlate('Dhaka Metro-Kha 12-3456'));
  assert.ok(!isValidPlate('ab'));
  assert.ok(!isValidPlate('ABCDEFG'));
});

test('ticket codes are random, 26 base32 chars (130 bits) and unique (NFR-SEC-04)', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const c = generateTicketCode();
    assert.match(c, /^PS-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{6}$/);
    assert.ok(!seen.has(c));
    seen.add(c);
  }
  assert.ok(26 * 5 >= 128);
});

test('ticket input accepts typed, lower-case, scanned URL forms', () => {
  const c = generateTicketCode();
  assert.equal(normaliseTicketInput(c), c);
  assert.equal(normaliseTicketInput(c.toLowerCase()), c);
  assert.equal(normaliseTicketInput(c.replace(/-/g, ' ')), c);
  assert.equal(normaliseTicketInput(`https://parksmart.example/t/${c}`), c);
  assert.equal(normaliseTicketInput(c.slice(3).replace(/-/g, '')), c);
  assert.equal(normaliseTicketInput('PS-123'), null);
  assert.equal(normaliseTicketInput(''), null);
});

test('validator coerces and rejects', () => {
  const out = validate({ a: ' x ', n: '5', b: 'true', e: 'A@B.CO' }, {
    a: { type: 'string', required: true }, n: { type: 'int', min: 1 }, b: { type: 'bool' }, e: { type: 'email' }, d: { type: 'int', default: 7 },
  });
  assert.deepEqual(out, { a: 'x', n: 5, b: true, e: 'a@b.co', d: 7 });
  assert.throws(() => validate({}, { a: { type: 'string', required: true } }), /A is required/);
  assert.throws(() => validate({ n: '0' }, { n: { type: 'int', min: 1 } }), /at least 1/);
  assert.throws(() => validate({ p: 'short' }, { p: { type: 'password' } }), /at least 8/);
  assert.throws(() => validate({ r: 'x' }, { r: { type: 'string', enum: ['a'] } }), /one of/);
  assert.throws(() => validate({ ph: '12' }, { ph: { type: 'phone' } }), /phone/);
});

test('formatting: BDT amounts and Dhaka DD/MM/YYYY 12-hour times (UI-06, C-5)', () => {
  assert.equal(bdt(1250), 'BDT 1,250');
  assert.equal(bdt(310500), 'BDT 3,10,500');
  assert.equal(dateTime('2026-11-01T04:15:00Z'), '01/11/2026 10:15 AM');
  assert.equal(dateTime('2026-11-01T19:40:00Z'), '02/11/2026 1:40 AM');
  assert.equal(dateOnly('2026-11-30'), '30/11/2026');
});
