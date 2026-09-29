/* Student login credential generation (username, initial password, WhatsApp message). Passwords are only
   returned at creation/reset time; the database stores the bcrypt hash only. */
const bcrypt = require("bcryptjs");
const { whatsappUrl } = require("./whatsappService");

const clean = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s.]/g, "").trim();

/* "Aarav Patel", "1" -> "aarav.patel1" */
function baseUsername(name, roll) {
  const n = clean(name).replace(/\s+/g, ".").replace(/\.+/g, ".").replace(/^\.|\.$/g, "") || "student";
  const r = String(roll || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${n}${r}`.slice(0, 40);
}

async function uniqueUsername(db, name, roll) {
  const base = baseUsername(name, roll);
  let candidate = base;
  for (let i = 2; i < 500; i++) {
    const r = await db.query("SELECT 1 AS x FROM Users WHERE Username = ?", [candidate]);
    if (!r.length) return candidate;
    candidate = `${base}${i}`;
  }
  return `${base}${Date.now()}`;
}

/* "Aarav Patel", "1" -> "Aarav@1" (first name capitalised + @ + roll). Always >= 6 chars. */
function generatePassword(name, roll) {
  const first = clean(name).split(/\s+/)[0].replace(/[^a-z0-9]/g, "") || "student";
  const r = String(roll || "").replace(/[^A-Za-z0-9]/g, "");
  let pw = `${first[0].toUpperCase()}${first.slice(1)}@${r}`;
  if (pw.length < 6) pw += "123";
  return pw;
}

function buildCredentialMessage({ name, username, password }) {
  return `Hello ${name},\n\nYour SmartAttendance student account has been created.\n\nUsername: ${username}\nPassword: ${password}\n\nYou can use these credentials to login to SmartAttendance.\n\nPlease keep your password secure.`;
}

const buildResetMessage = ({ name, username, password }) =>
  `Hello ${name},\n\nYour SmartAttendance login password has been reset.\n\nUsername: ${username}\nTemporary password: ${password}\n\nPlease login and keep your password secure.`;

/* Creates the Student user for an existing Students row (never duplicates). Returns
   { created, username, password, whatsappUrl, whatsappError } ; created=false when a login already exists. */
async function createStudentLogin(db, student) {
  const ex = await db.query("SELECT UserId, Username FROM Users WHERE StudentID = ?", [student.StudentID]);
  if (ex.length) return { created: false, userId: Number(ex[0].UserId), username: ex[0].Username };
  const username = await uniqueUsername(db, student.Name, student.RollNumber);
  const password = generatePassword(student.Name, student.RollNumber);
  const hash = await bcrypt.hash(password, 10);
  const ins = await db.query(
    "INSERT INTO Users (FullName, Username, PasswordHash, Role, Phone, StudentID) OUTPUT INSERTED.UserId AS id VALUES (?, ?, ?, 'Student', ?, ?)",
    [String(student.Name).trim(), username, hash, String(student.ParentPhone || "").trim(), student.StudentID]);
  return { created: true, userId: Number(ins[0].id), username, password, ...waLink(student, username, password, buildCredentialMessage) };
}

function waLink(student, username, password, builder) {
  const url = whatsappUrl(student.ParentPhone, builder({ name: student.Name, username, password }));
  return { whatsappUrl: url, whatsappError: url ? null : "Phone number is missing or invalid, so no WhatsApp link was created." };
}

/* Sets a fresh generated password for the existing login. */
async function resetStudentPassword(db, student, userId, username) {
  const password = `${generatePassword(student.Name, student.RollNumber)}${Math.floor(10 + Math.random() * 90)}`;
  const hash = await bcrypt.hash(password, 10);
  await db.query("UPDATE Users SET PasswordHash = ? WHERE UserId = ? AND Role = 'Student'", [hash, userId]);
  return { username, password, ...waLink(student, username, password, buildResetMessage) };
}

module.exports = { baseUsername, uniqueUsername, generatePassword, buildCredentialMessage, createStudentLogin, resetStudentPassword };
