/* Manual "click to send" WhatsApp links (wa.me). Nothing is sent automatically. */

const isAutoWhatsAppConfigured = () => Boolean(
  process.env.WHATSAPP_API_KEY ||
  process.env.WHATSAPP_ACCESS_TOKEN ||
  process.env.WHATSAPP_PHONE_NUMBER_ID ||
  process.env.TWILIO_ACCOUNT_SID ||
  process.env.TWILIO_AUTH_TOKEN
);

const whatsappMode = () => (isAutoWhatsAppConfigured() ? "api" : "click_to_send");

/* Returns digits with country code (default India +91) or null when the number is not valid. */
const toIntlPhone = (parentPhone) => {
  let d = String(parentPhone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  if (d.length === 12 && d.startsWith("91")) return /^91[6-9]\d{9}$/.test(d) ? d : null;
  return d.length >= 11 && d.length <= 15 && !d.startsWith("91") ? d : null;
};

const fmtDMY = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}-${m}-${y}`; };

const buildAbsentMessage = ({ name, date, classNumber, section, subject, period }) => {
  const where = [subject, classNumber ? `Class ${classNumber}-${section || ""}` : null, period ? `Period ${period}` : null].filter(Boolean).join(", ");
  return `Dear Parent,\nThis is to inform you that your child ${name} was marked ABSENT${where ? ` for ${where}` : ""} on ${fmtDMY(date)}.\n\nRegards,\nSmart Attendance`;
};

/* null when the phone is invalid - callers must handle that */
const whatsappUrl = (parentPhone, message) => {
  const p = toIntlPhone(parentPhone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(message)}` : null;
};

/* Legacy signature kept for older callers. */
const openWhatsApp = (parentPhone, studentName, date) =>
  whatsappUrl(parentPhone, buildAbsentMessage({ name: studentName, date }));

module.exports = { openWhatsApp, buildAbsentMessage, whatsappUrl, toIntlPhone, whatsappMode, isAutoWhatsAppConfigured };
