const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { getConnection } = require("../config/db");
const { getLinkedStudentId } = require("../config/helpers");
const { parseClassNumber, ensureSection } = require("../config/schema");
const { parseFile, pickField } = require("../config/importParser");
const { toIntlPhone, whatsappUrl } = require("../config/whatsappService");

const fail = (res, err) => { console.error("[API ERROR]", err.message); res.status(500).json({ message: `Database error: ${err.message}`, error: err.message }); };
const isAdmin = (req) => String(req.user.role).toLowerCase() === "admin";
const phoneOk = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 7 && d.length <= 15; };
const portalUrlFor = (req) => {
  try {
    const parsed = new URL(process.env.FRONTEND_URL || req.get("origin"));
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch { return null; }
};
const studentPortalWhatsAppUrl = (student, username, password, portalUrl) => {
  const message = `Dear Parent,\n\nYour child ${student.Name}'s Student Portal login details are:\n\nUsername: ${username}\nPassword: ${password}\n\nStudent Portal:\n${portalUrl}\n\nPlease keep these credentials safe.`;
  return whatsappUrl(student.ParentPhone, message);
};

/* Columns returned to the frontend (Class/Section are the human values). */
const STUDENT_SELECT = `
  SELECT st.StudentID, st.RollNumber, st.Name, c.ClassNumber AS Class, c.ClassName, s.SectionName AS Section,
         st.ClassID, st.SectionID, st.ParentName, st.ParentPhone,
         lu.UserId AS LinkedUserId, lu.Username AS LinkedUsername
  FROM Students st
  LEFT JOIN Classes c ON c.ClassID = st.ClassID
  LEFT JOIN Sections s ON s.SectionID = st.SectionID
    LEFT JOIN Users lu ON lu.StudentID = st.StudentID AND lu.Role = 'Student'`;

/* Resolve (class, section) text -> ids. Creates a simple section (A, B, 1...) if missing. */
async function resolveClassSection(db, classVal, sectionVal) {
  const n = parseClassNumber(classVal);
  if (!n) return { error: "Class must be between 1 and 12." };
  const c = await db.query("SELECT ClassID FROM Classes WHERE ClassNumber = ?", [n]);
  if (!c.length) return { error: `Class ${n} does not exist.` };
  const classId = Number(c[0].ClassID);
  const sec = String(sectionVal || "").trim().toUpperCase();
  if (!sec) return { error: "Section is required." };
  if (!/^[A-Z0-9]{1,5}$/.test(sec)) return { error: `Invalid section "${sectionVal}".` };
  const sectionId = await ensureSection(db, classId, sec);
  return { classNumber: n, classId, sectionId, sectionName: sec };
}

/* ---------------- add ---------------- */
const addStudent = async (req, res) => {
  const { rollNumber, name, studentClass, section, parentName, parentPhone, createLogin, username, password } = req.body;
  if (!rollNumber || !name || !studentClass || !section || !parentPhone) {
    return res.status(400).json({ message: "Roll number, name, class, section and parent phone are required." });
  }
  if (!phoneOk(parentPhone)) return res.status(400).json({ message: "Enter a valid parent phone number." });
  try {
    const db = await getConnection();
    const cs = await resolveClassSection(db, studentClass, section);
    if (cs.error) return res.status(400).json({ message: cs.error });
    const dup = await db.query("SELECT 1 AS x FROM Students WHERE RollNumber = ? AND ClassID = ? AND SectionID = ?", [String(rollNumber).trim(), cs.classId, cs.sectionId]);
    if (dup.length) return res.status(409).json({ message: `Roll number ${rollNumber} already exists in Class ${cs.classNumber}-${cs.sectionName}.` });

    const ins = await db.query(
      `INSERT INTO Students (RollNumber, Name, Class, Section, ParentName, ParentPhone, ClassID, SectionID)
       OUTPUT INSERTED.StudentID AS id VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(rollNumber).trim(), String(name).trim(), String(cs.classNumber), cs.sectionName, parentName || "", String(parentPhone).trim(), cs.classId, cs.sectionId]);
    const studentId = Number(ins[0].id);

    let loginError = null;
    if (createLogin) {
      try {
        if (!username || String(username).trim().length < 3 || !password || String(password).length < 6) throw new Error("Login username needs 3+ characters and password 6+ characters.");
        const ex = await db.query("SELECT 1 AS x FROM Users WHERE Username = ?", [String(username).trim()]);
        if (ex.length) throw new Error("Username already exists.");
        const hash = await bcrypt.hash(String(password), 10);
        await db.query("INSERT INTO Users (FullName, Username, PasswordHash, Role, Phone, StudentID) VALUES (?, ?, ?, 'Student', ?, ?)",
          [String(name).trim(), String(username).trim(), hash, String(parentPhone).trim(), studentId]);
      } catch (e) { loginError = e.message; }
    }
    res.status(201).json({ message: loginError ? `Student added, but login was not created: ${loginError}` : "Student added successfully!", studentId, loginError });
  } catch (e) { fail(res, e); }
};

/* ---------------- list (role scoped) ---------------- */
const getStudents = async (req, res) => {
  try {
    const db = await getConnection();
    const role = String(req.user.role).toLowerCase();
    if (role === "admin") {
      return res.json(await db.query(`${STUDENT_SELECT} WHERE st.IsActive = 1 ORDER BY c.ClassNumber, s.SectionName, TRY_CAST(st.RollNumber AS INT), st.RollNumber`));
    }
    if (role === "teacher") {   // only students of the teacher's own assigned class+section
      return res.json(await db.query(
        `${STUDENT_SELECT}
         WHERE st.IsActive = 1 AND EXISTS (SELECT 1 FROM TeacherAssignments ta WHERE ta.TeacherUserID = ? AND ta.ClassID = st.ClassID AND ta.SectionID = st.SectionID)
         ORDER BY c.ClassNumber, s.SectionName, TRY_CAST(st.RollNumber AS INT), st.RollNumber`, [req.user.userId]));
    }
    res.status(403).json({ message: "You do not have permission to view the student list." });
  } catch (e) { fail(res, e); }
};

/* ---------------- edit / delete (Admin) ---------------- */
const updateStudent = async (req, res) => {
  const { rollNumber, name, studentClass, section, parentName, parentPhone } = req.body;
  if (!rollNumber || !name || !studentClass || !section || !parentPhone) return res.status(400).json({ message: "Roll number, name, class, section and parent phone are required." });
  if (!phoneOk(parentPhone)) return res.status(400).json({ message: "Enter a valid parent phone number." });
  try {
    const db = await getConnection();
    const ex = await db.query("SELECT StudentID FROM Students WHERE StudentID = ?", [req.params.id]);
    if (!ex.length) return res.status(404).json({ message: "Student not found." });
    const cs = await resolveClassSection(db, studentClass, section);
    if (cs.error) return res.status(400).json({ message: cs.error });
    const dup = await db.query("SELECT 1 AS x FROM Students WHERE RollNumber = ? AND ClassID = ? AND SectionID = ? AND StudentID <> ?", [String(rollNumber).trim(), cs.classId, cs.sectionId, req.params.id]);
    if (dup.length) return res.status(409).json({ message: `Roll number ${rollNumber} already exists in Class ${cs.classNumber}-${cs.sectionName}.` });
    await db.query(
      "UPDATE Students SET RollNumber=?, Name=?, Class=?, Section=?, ParentName=?, ParentPhone=?, ClassID=?, SectionID=? WHERE StudentID=?",
      [String(rollNumber).trim(), String(name).trim(), String(cs.classNumber), cs.sectionName, parentName || "", String(parentPhone).trim(), cs.classId, cs.sectionId, req.params.id]);
    res.json({ message: "Student updated." });
  } catch (e) { fail(res, e); }
};

const deleteStudent = async (req, res) => {
  try {
    const db = await getConnection();
    const students = await db.query("SELECT StudentID FROM Students WHERE StudentID = ?", [req.params.id]);
    if (!students.length) return res.status(404).json({ message: "Student not found." });
    const studentId = students[0].StudentID;
    const history = await db.query("SELECT COUNT(*) AS n FROM Attendance WHERE StudentID = ?", [studentId]);
    if (Number(history[0].n)) return res.status(409).json({ message: "This student has attendance history and cannot be permanently deleted. You can deactivate this student instead.", code: "HAS_ATTENDANCE" });

    const accounts = await db.query("SELECT UserId FROM Users WHERE StudentID = ? AND Role = 'Student'", [studentId]);
    for (const account of accounts) {
      const refs = await db.query(
        `SELECT (SELECT COUNT(*) FROM TeacherAssignments WHERE TeacherUserID = ?) AS AssignmentRefs,
                (SELECT COUNT(*) FROM Attendance WHERE TeacherUserID = ?) AS AttendanceRefs`,
        [account.UserId, account.UserId]
      );
      if (Number(refs[0].AssignmentRefs) || Number(refs[0].AttendanceRefs)) {
        return res.status(409).json({ message: "The linked Student login is referenced by other records and cannot be safely deleted." });
      }
    }

    const removed = await db.query(
      "DELETE FROM Students OUTPUT DELETED.StudentID AS StudentID WHERE StudentID = ? AND NOT EXISTS (SELECT 1 FROM Attendance WHERE StudentID = ?)",
      [studentId, studentId]
    );
    if (!removed.length) return res.status(409).json({ message: "This student has attendance history and cannot be permanently deleted. You can deactivate this student instead.", code: "HAS_ATTENDANCE" });
    await db.query("DELETE FROM Users WHERE StudentID = ? AND Role = 'Student'", [studentId]);
    res.json({ message: accounts.length ? "Student and linked login account permanently deleted." : "Student permanently deleted." });
  } catch (e) { fail(res, e); }
};

const deactivateStudent = async (req, res) => {
  try {
    const db = await getConnection();
    const exists = await db.query("SELECT StudentID FROM Students WHERE StudentID = ?", [req.params.id]);
    if (!exists.length) return res.status(404).json({ message: "Student not found." });
    const updated = await db.query("UPDATE Students SET IsActive = 0 OUTPUT INSERTED.StudentID AS StudentID WHERE StudentID = ? AND IsActive = 1", [exists[0].StudentID]);
    if (!updated.length) return res.status(409).json({ message: "Student is already deactivated." });
    res.json({ message: "Student deactivated. Attendance history has been preserved." });
  } catch (e) { fail(res, e); }
};

/* ---------------- student self (identity from JWT -> Users.StudentID) ---------------- */
const getMe = async (req, res) => {
  try {
    const id = await getLinkedStudentId(req.user.userId);
    if (id === null) return res.status(404).json({ message: "Your account is not linked to a student record yet.", code: "NOT_LINKED" });
    const db = await getConnection();
    const r = await db.query(`${STUDENT_SELECT} WHERE st.StudentID = ? AND st.IsActive = 1`, [id]);
    if (!r.length) return res.status(404).json({ message: "Student record not found.", code: "NOT_LINKED" });
    res.json(r[0]);
  } catch (e) { fail(res, e); }
};

const getMyTimetable = async (req, res) => {
  try {
    const studentId = await getLinkedStudentId(req.user.userId);
    if (studentId === null) return res.status(404).json({ message: "Your account is not linked to a student record yet.", code: "NOT_LINKED" });
    const db = await getConnection();
    const students = await db.query("SELECT ClassID, SectionID FROM Students WHERE StudentID = ? AND IsActive = 1", [studentId]);
    if (!students.length) return res.status(404).json({ message: "Student record not found.", code: "NOT_LINKED" });
    const { ClassID: classId, SectionID: sectionId } = students[0];
    if (classId == null || sectionId == null) return res.json([]);
    const rows = await db.query(
      `SELECT te.TimetableEntryID, te.DayOfWeek, te.Period,
              CONVERT(VARCHAR(5), te.StartTime, 108) AS StartTime,
              CONVERT(VARCHAR(5), te.EndTime, 108) AS EndTime,
              sub.SubjectName, u.FullName AS TeacherName
       FROM TimetableEntries te
       JOIN Classes c ON c.ClassID = te.ClassID
       JOIN Sections sec ON sec.SectionID = te.SectionID AND sec.ClassID = te.ClassID
       JOIN Subjects sub ON sub.SubjectID = te.SubjectID
       JOIN Users u ON u.UserId = te.TeacherUserID AND u.Role = 'Teacher'
       WHERE te.ClassID = ? AND te.SectionID = ?
       ORDER BY te.DayOfWeek, te.Period`,
      [classId, sectionId]
    );
    res.json(rows.map((row) => ({ timetableEntryId: row.TimetableEntryID, dayOfWeek: Number(row.DayOfWeek), period: Number(row.Period), subject: row.SubjectName, teacher: row.TeacherName, startTime: row.StartTime, endTime: row.EndTime })));
  } catch (e) { fail(res, e); }
};

/* ---------------- login accounts <-> student link ---------------- */
const getAccounts = async (req, res) => {
  try {
    const db = await getConnection();
    res.json(await db.query("SELECT UserId, FullName, Username, StudentID FROM Users WHERE Role = 'Student' ORDER BY FullName"));
  } catch (e) { fail(res, e); }
};

const linkAccount = async (req, res) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "userId")) {
      return res.status(400).json({ message: "Student accounts are resolved from the selected student's StudentID; userId selection is not supported." });
    }
    const db = await getConnection();
    const students = await db.query("SELECT StudentID, Name, ParentPhone FROM Students WHERE StudentID = ? AND IsActive = 1", [req.params.id]);
    if (!students.length) return res.status(404).json({ message: "Student not found." });
    const student = students[0];
    if (req.body?.unlink === true) {
      await db.query("UPDATE Users SET StudentID = NULL WHERE StudentID = ? AND Role = 'Student'", [student.StudentID]);
      return res.json({ message: "Login unlinked." });
    }
    const accounts = await db.query("SELECT UserId, Username FROM Users WHERE StudentID = ? AND Role = 'Student'", [student.StudentID]);
    if (!accounts.length) return res.status(404).json({ message: "This student does not have a login account yet.", code: "NO_STUDENT_LOGIN" });
    if (accounts.length > 1) return res.status(409).json({ message: "More than one Student login is linked to this student. Ask an administrator to resolve the duplicate accounts." });
    if (!toIntlPhone(student.ParentPhone)) return res.status(400).json({ message: "This student has no valid parent phone number. Update it before preparing the WhatsApp message." });
    const portalUrl = portalUrlFor(req);
    if (!portalUrl) return res.status(500).json({ message: "Student Portal URL is not configured. Set FRONTEND_URL or open the Admin dashboard from the portal." });
    const temporaryPassword = crypto.randomBytes(12).toString("hex");
    const link = studentPortalWhatsAppUrl(student, accounts[0].Username, temporaryPassword, portalUrl);
    if (!link) return res.status(400).json({ message: "The parent phone number could not be used for WhatsApp." });
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    const updated = await db.query(
      "UPDATE Users SET PasswordHash = ? OUTPUT INSERTED.UserId AS UserId WHERE UserId = ? AND StudentID = ? AND Role = 'Student'",
      [passwordHash, accounts[0].UserId, student.StudentID]
    );
    if (!updated.length) return res.status(409).json({ message: "The student's login relationship changed. Please retry." });
    res.json({ message: "Login verified. The WhatsApp message is prepared; it has not been sent.", username: accounts[0].Username, whatsappUrl: link });
  } catch (e) { fail(res, e); }
};


const createStudentLogin = async (req, res) => {
  const username = String(req.body?.username || "").trim();
  if (username.length < 3) return res.status(400).json({ message: "Username must be at least 3 characters." });
  try {
    const db = await getConnection();
    const students = await db.query("SELECT StudentID, Name, ParentPhone FROM Students WHERE StudentID = ? AND IsActive = 1", [req.params.id]);
    if (!students.length) return res.status(404).json({ message: "Student not found." });
    const student = students[0];
    const linked = await db.query("SELECT UserId FROM Users WHERE StudentID = ? AND Role = 'Student'", [student.StudentID]);
    if (linked.length) return res.status(409).json({ message: "This student already has a login account. Use Link to prepare its credentials." });
    if (!toIntlPhone(student.ParentPhone)) return res.status(400).json({ message: "This student has no valid parent phone number. Update it before preparing the WhatsApp message." });
    const existing = await db.query("SELECT 1 AS x FROM Users WHERE Username = ?", [username]);
    if (existing.length) return res.status(409).json({ message: "Username already exists." });
    const portalUrl = portalUrlFor(req);
    if (!portalUrl) return res.status(500).json({ message: "Student Portal URL is not configured. Set FRONTEND_URL or open the Admin dashboard from the portal." });
    const temporaryPassword = crypto.randomBytes(12).toString("hex");
    const link = studentPortalWhatsAppUrl(student, username, temporaryPassword, portalUrl);
    if (!link) return res.status(400).json({ message: "The parent phone number could not be used for WhatsApp." });
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await db.query(
      "INSERT INTO Users (FullName, Username, PasswordHash, Role, Phone, StudentID) VALUES (?, ?, ?, 'Student', ?, ?)",
      [student.Name, username, passwordHash, String(student.ParentPhone).trim(), student.StudentID]
    );
    res.status(201).json({ message: "Student login created. The WhatsApp message is prepared; it has not been sent.", username, whatsappUrl: link });
  } catch (e) { fail(res, e); }
};
/* ---------------- bulk import (CSV / XLS / XLSX) ---------------- */
const importStudents = async (req, res) => {
  let rows;
  try { rows = parseFile(req.body.filename, req.body.contentBase64); }
  catch (e) { return res.status(400).json({ message: e.message }); }
  try {
    const db = await getConnection();
    const result = { total: rows.length, imported: 0, failed: 0, duplicates: 0, failures: [], duplicateRows: [], imported_rows: [] };
    const seen = new Set();
    for (const r of rows) {
      const roll = String(pickField(r, "RollNumber", "Roll No", "Roll")).trim();
      const name = String(pickField(r, "Name", "StudentName")).trim();
      const cls = pickField(r, "Class");
      const sec = pickField(r, "Section");
      const parentName = String(pickField(r, "ParentName", "Parent Name")).trim();
      const parentPhone = String(pickField(r, "ParentPhone", "Parent Phone")).trim();
      const sid = String(pickField(r, "StudentID", "Student ID")).trim();
      const bad = (reason) => { result.failed++; result.failures.push({ row: r.__row, roll, name, reason }); };

      if (!roll) { bad("Roll Number is missing."); continue; }
      if (!name) { bad("Name is missing."); continue; }
      if (!parentPhone) { bad("Parent Phone is missing."); continue; }
      if (!phoneOk(parentPhone)) { bad(`Invalid Parent Phone "${parentPhone}".`); continue; }
      try {
        const cs = await resolveClassSection(db, cls, sec);
        if (cs.error) { bad(cs.error); continue; }
        const label = `Class ${cs.classNumber}-${cs.sectionName}`;
        const k = `${cs.classId}|${cs.sectionId}|${roll.toLowerCase()}`;
        const dup = async (why) => { result.duplicates++; result.duplicateRows.push({ row: r.__row, roll, name, reason: why }); };
        if (seen.has(k)) { await dup(`Roll ${roll} appears more than once in the file for ${label}.`); continue; }
        seen.add(k);
        if (/^\d+$/.test(sid)) {
          const e = await db.query("SELECT 1 AS x FROM Students WHERE StudentID = ?", [sid]);
          if (e.length) { await dup(`StudentID ${sid} already exists.`); continue; }
        }
        const e2 = await db.query("SELECT 1 AS x FROM Students WHERE RollNumber = ? AND ClassID = ? AND SectionID = ?", [roll, cs.classId, cs.sectionId]);
        if (e2.length) { await dup(`Roll ${roll} already exists in ${label}.`); continue; }

        await db.query(
          "INSERT INTO Students (RollNumber, Name, Class, Section, ParentName, ParentPhone, ClassID, SectionID) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [roll, name, String(cs.classNumber), cs.sectionName, parentName, parentPhone, cs.classId, cs.sectionId]);
        const t = await db.query("SELECT COUNT(DISTINCT TeacherUserID) AS n FROM TeacherAssignments WHERE ClassID = ? AND SectionID = ?", [cs.classId, cs.sectionId]);
        result.imported++;
        result.imported_rows.push({ row: r.__row, roll, name, classSection: label, teachersWhoSeeStudent: Number(t[0].n) });
      } catch (e) { bad(e.message); }
    }
    res.json({ message: `Import finished: ${result.imported} imported, ${result.duplicates} duplicate, ${result.failed} failed.`, ...result });
  } catch (e) { fail(res, e); }
};

module.exports = { addStudent, getStudents, updateStudent, deleteStudent, deactivateStudent, getMe, getMyTimetable, getAccounts, linkAccount, createStudentLogin, importStudents };
