const PDFDocument = require('pdfkit');
const { bdt, dateTime, dateOnly } = require('../utils/format');

const METHOD = { cash: 'Cash', online: 'Online (sandbox)', pass: 'Monthly pass' };

/** FR-BIL-08 printable receipt as PDF (80 mm-friendly narrow layout). */
function receiptPdf(r, stream) {
  const doc = new PDFDocument({ size: [227, 520], margin: 14 }); // ~80 mm wide
  doc.pipe(stream);
  doc.font('Helvetica-Bold').fontSize(13).text('ParkSmart', { align: 'center' });
  doc.font('Helvetica').fontSize(8).text(r.kind === 'pass' ? 'Monthly pass receipt' : 'Parking receipt', { align: 'center' });
  doc.moveDown(0.6);
  const row = (k, v) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(8).text(k, 14, y, { width: 80 });
    doc.font('Helvetica-Bold').text(String(v ?? '—'), 94, y, { width: 119, align: 'right' });
    doc.moveDown(0.25);
  };
  row('Receipt no.', r.receipt_no);
  row('Paid at', dateTime(r.paid_at));
  if (r.session) {
    row('Plate', r.session.plate);
    row('Facility', r.session.facility);
    row('Slot', `${r.session.zone} · ${r.session.slot}`);
    row('Entry', dateTime(r.session.entry_time));
    row('Exit', dateTime(r.session.exit_time));
    row('Duration', r.session.duration);
    if (r.session.is_lost_ticket) row('Lost ticket', 'Yes');
  }
  if (r.pass) {
    row('Holder', r.pass.holder);
    row('Plate', r.pass.plate);
    row('Facility', r.pass.facility);
    row('Valid', `${dateOnly(r.pass.start_date)} – ${dateOnly(r.pass.end_date)}`);
  }
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(8).text('Fee breakdown', 14);
  doc.font('Helvetica').fontSize(7.5);
  for (const l of r.breakdown || []) doc.text(`• ${l}`, { width: 199 });
  if (r.original_amount !== null && r.original_amount !== undefined) {
    doc.text(`• Override by ${r.overridden_by}: ${bdt(r.original_amount)} -> ${bdt(r.amount)} (${r.override_reason})`, { width: 199 });
  }
  doc.moveDown(0.5);
  row('Payment method', METHOD[r.method] || r.method);
  row('Operator', r.operator || 'Online');
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(12).text(`Total ${bdt(r.amount)}`, { align: 'center' });
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(7).text('Thank you for parking with ParkSmart.', { align: 'center' });
  doc.end();
}

/** FR-REP-04: tabular report to PDF. columns: [{key,label,width,align}] */
function tablePdf({ title, subtitle, columns, rows, totals }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(stream);
  doc.font('Helvetica-Bold').fontSize(16).text(`ParkSmart — ${title}`);
  if (subtitle) doc.font('Helvetica').fontSize(9).fillColor('#555').text(subtitle).fillColor('#000');
  doc.moveDown(0.8);
  const totalWidth = 515;
  const sum = columns.reduce((a, c) => a + (c.width || 1), 0);
  const widths = columns.map((c) => ((c.width || 1) / sum) * totalWidth);
  const drawRow = (vals, bold) => {
    if (doc.y > 780) doc.addPage();
    const y = doc.y;
    let x = 40;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    let maxH = 0;
    vals.forEach((v, i) => {
      doc.text(String(v ?? ''), x + 2, y, { width: widths[i] - 4, align: columns[i].align || 'left' });
      maxH = Math.max(maxH, doc.y - y);
      x += widths[i];
    });
    doc.y = y + maxH + 4;
    doc.moveTo(40, doc.y - 2).lineTo(555, doc.y - 2).lineWidth(0.3).strokeColor('#ccc').stroke();
  };
  drawRow(columns.map((c) => c.label), true);
  for (const r of rows) drawRow(columns.map((c) => (c.format ? c.format(r[c.key], r) : r[c.key])));
  if (totals) drawRow(columns.map((c) => (totals[c.key] !== undefined ? (c.format ? c.format(totals[c.key]) : totals[c.key]) : '')), true);
  if (!rows.length) doc.moveDown().font('Helvetica-Oblique').text('No data for the selected range.');
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(7).fillColor('#777').text(`Generated ${dateTime(new Date())} (Asia/Dhaka)`);
  doc.end();
}

module.exports = { receiptPdf, tablePdf };
