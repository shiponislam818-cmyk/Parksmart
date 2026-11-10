const nodemailer = require('nodemailer');
const config = require('../config');
const { dateOnly } = require('../utils/format');

let transport = null;

/**
 * OI-7: real SMTP when SMTP_HOST is configured; otherwise emails are written to the
 * server console (JSON transport) so the reminder flow still runs end to end.
 */
function getTransport() {
  if (transport) return transport;
  transport = config.smtp.host
    ? nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
    : nodemailer.createTransport({ jsonTransport: true });
  return transport;
}

async function sendPassReminder(p) {
  if (!p.email) return;
  const info = await getTransport().sendMail({
    from: config.smtp.from,
    to: p.email,
    subject: `ParkSmart: your monthly pass expires on ${dateOnly(p.end_date)}`,
    text: `Hello ${p.name},\n\nYour ParkSmart monthly pass for ${p.plate_number} at ${p.facility_name} expires on ${dateOnly(p.end_date)}.\nRenew it from the driver portal (My passes > Renew) to keep parking without per-visit fees.\n\nParkSmart`,
  });
  if (!config.smtp.host) console.log(`[email:console] pass reminder -> ${p.email} (pass #${p.id})`);
  return info;
}

module.exports = { sendPassReminder };
