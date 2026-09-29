const bcrypt = require("bcryptjs");
const { getConnection } = require("../config/db");
const { getLinkedStudentId } = require("../config/helpers");
const { createStudentLogin, resetStudentPassword } = require("../config/credentials");
const { parseClassNumber, ensureSection } = require("../config/schema");
const { parseFile, pickField } = require("../config/importParser");

const fail = (res, err) => { console.error("[API ERROR]", err.message); res.status(500).json({ message: "Something went wrong on the server. Please try again." }); };
const isAdmin = (req) => String(req.user.role).toLowerCase() === "admin";
const phoneOk = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 7 && d.length <= 15; };

/* Columns returned to the frontend (Class/Section are the human values). */
const STUDENT_SELECT = `
  SELECT st.StudentID, st.RollNumber, st.Name, c.ClassNumber AS Class, c.ClassName, s.SectionName AS Section,
         st.ClassID, st.SectionID, st.ParentName, st.ParentPhone,
         lu.UserId AS LinkedUserId, lu.Username AS LinkedUsername
  FROM Students st
  LEFT JOIN Classes c ON c.ClassID = st.ClassID
  LEFT JOIN Sections s ON s.SectionID = st.SectionID
  LEFT JOIN Users lu ON lu.StudentID = st.StudentID`;

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

/* ---------------- add (a Student login is always created automatically) ---------------- */
const addStudent = async (req, res) => {
  const { rollNumber, name, studentClass, section, parentName, parentPhone } = req.body;
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

    let login = null, loginError = null;
    try {
      login = await createStudentLogin(db, { StudentID: studentId, Name: String(name).trim(), RollNumber: String(rollNumber).trim(), ParentPhone: String(parentPhone).trim() });
    } catch (e) { console.error("[login create]", e.message); loginError = "The student was saved, but the login could not be created. Use 'Create Login' from the student list."; }
    res.status(201).json({
      message: loginError || "Student added successfully. Login credentials generated.",
      studentId, loginError,
      username: login ? login.username : null,
      password: login && login.created ? login.password : null,
      whatsappUrl: login ? login.whatsappUrl || null : null,
      whatsappError: login ? login.whatsappError || null : null,
    });
  } catch (e) { fail(res, e); }
};

/* ---------------- list (role scoped) ---------------- */
const getStudents = async (req, res) => {
  try {
    const db = await getConnection();
    const role = String(req.user.role).toLowerCase();
    if (role === "admin") {
      return res.json(await db.query(`${STUDENT_SELECT} ORDER BY c.ClassNumber, s.SectionName, TRY_CAST(st.RollNumber AS INT), st.RollNumber`));
    }
    if (role === "teacher") {   // only students of the teacher's own assigned class+section
      return res.json(await db.query(
        `${STUDENT_SELECT}
         WHERE EXISTS (SELECT 1 FROM TeacherAssignments ta WHERE ta.TeacherUserID = ? AND ta.ClassID = st.ClassID AND ta.SectionID = st.SectionID)
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
    const a = await db.query("SELECT COUNT(*) AS n FROM Attendance WHERE StudentID = ?", [req.params.id]);
    if (Number(a[0].n)) return res.status(409).json({ message: `This student has ${a[0].n} attendance record(s). Attendance history is never deleted, so the student cannot be deleted.` });
    await db.query("UPDATE Users SET StudentID = NULL WHERE StudentID = ?", [req.params.id]);
    await db.query("DELETE FROM Students WHERE StudentID = ?", [req.params.id]);
    res.json({ message: "Student deleted." });
  } catch (e) { fail(res, e); }
};

/* ---------------- student self (identity from JWT -> Users.StudentID) ---------------- */
const getMe = async (req, res) => {
  try {
    const id = await getLinkedStudentId(req.user.userId);
    if (id === null) return res.status(404).json({ message: "Your account is not linked to a student record yet.", code: "NOT_LINKED" });
    const db = await getConnection();
    const r = await db.query(`${STUDENT_SELECT} WHERE st.StudentID = ?`, [id]);
    if (!r.length) return res.status(404).json({ message: "Student record not found.", code: "NOT_LINKED" });
    res.json(r[0]);
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
  const { userId } = req.body;
  try {
    const db = await getConnection();
    await db.query("UPDATE Users SET StudentID = NULL WHERE StudentID = ?", [req.params.id]);
    if (userId) {
      const u = await db.query("SELECT 1 AS x FROM Users WHERE UserId = ? AND Role = 'Student'", [userId]);
      if (!u.length) return res.status(400).json({ message: "Selected account is not a student login." });
      await db.query("UPDATE Users SET StudentID = ? WHERE UserId = ?", [req.params.id, userId]);
    }
    res.json({ message: userId ? "Login linked to student." : "Login unlinked." });
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

        const ins = await db.query(
          "INSERT INTO Students (RollNumber, Name, Class, Section, ParentName, ParentPhone, ClassID, SectionID) OUTPUT INSERTED.StudentID AS id VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [roll, name, String(cs.classNumber), cs.sectionName, parentName, parentPhone, cs.classId, cs.sectionId]);
        let login = null;
        try { login = await createStudentLogin(db, { StudentID: Number(ins[0].id), Name: name, RollNumber: roll, ParentPhone: parentPhone }); }
        catch (e) { console.error("[import login]", e.message); }
        const t = await db.query("SELECT COUNT(DISTINCT TeacherUserID) AS n FROM TeacherAssignments WHERE ClassID = ? AND SectionID = ?", [cs.classId, cs.sectionId]);
        result.imported++;
        result.imported_rows.push({ row: r.__row, roll, name, classSection: label, teachersWhoSeeStudent: Number(t[0].n), username: login ? login.username : null, password: login && login.created ? login.password : null, whatsappUrl: login ? login.whatsappUrl || null : null });
      } catch (e) { bad(e.message); }
    }
    res.json({ message: `Import finished: ${result.imported} imported, ${result.duplicates} duplicate, ${result.failed} failed.`, ...result });
  } catch (e) { fail(res, e); }
};

/* ---------------- student self: identity ALWAYS from JWT -> Users.StudentID ---------------- */
const selfId = async (req, res) => {
  const id = await getLinkedStudentId(req.user.userId);
  if (id === null) { res.status(404).json({ message: "Your account is not linked to a student record yet.", code: "NOT_LINKED" }); return null; }
  return id;
};

const getMyAttendanceSummary = async (req, res) => {
  try {
    const id = await selfId(req, res); if (id === null) return;
    const db = await getConnection();
    const r = await db.query("SELECT COUNT(*) AS total, SUM(CASE WHEN Status = 'Present' THEN 1 ELSE 0 END) AS present, SUM(CASE WHEN Status = 'Absent' THEN 1 ELSE 0 END) AS absent FROM Attendance WHERE StudentID = ?", [id]);
    const total = Number(r[0].total) || 0, present = Number(r[0].present) || 0, absent = Number(r[0].absent) || 0;
    res.json({ total, present, absent, percentage: total ? Math.round((present / total) * 1000) / 10 : null });
  } catch (e) { fail(res, e); }
};

/* Timetable = TeacherAssignments of the student's own ClassID + SectionID (the schema has no weekday column,
   so the same period schedule applies to every school day). */
const getMyTimetable = async (req, res) => {
  try {
    const id = await selfId(req, res); if (id === null) return;
    const db = await getConnection();
    res.json(await db.query(
      `SELECT ta.AssignmentID, ta.Period, sub.SubjectName AS Subject, u.FullName AS TeacherName,
              CONVERT(VARCHAR(5), ta.StartTime, 108) AS StartTime, CONVERT(VARCHAR(5), ta.EndTime, 108) AS EndTime
       FROM Students st
       JOIN TeacherAssignments ta ON ta.ClassID = st.ClassID AND ta.SectionID = st.SectionID
       JOIN Subjects sub ON sub.SubjectID = ta.SubjectID
       JOIN Users u ON u.UserId = ta.TeacherUserID
       WHERE st.StudentID = ? ORDER BY ta.Period`, [id]));
  } catch (e) { fail(res, e); }
};

/* ---------------- Admin: login info / create / reset / bulk-create ---------------- */
const loadStudent = async (db, id) => {
  const r = await db.query("SELECT StudentID, RollNumber, Name, ParentPhone FROM Students WHERE StudentID = ?", [id]);
  return r[0] || null;
};

const getLoginInfo = async (req, res) => {
  try {
    const db = await getConnection();
    const st = await loadStudent(db, req.params.id);
    if (!st) return res.status(404).json({ message: "Student not found." });
    const u = await db.query("SELECT UserId, Username FROM Users WHERE StudentID = ? AND Role = 'Student'", [st.StudentID]);
    res.json({ studentId: Number(st.StudentID), loginCreated: u.length > 0, username: u.length ? u[0].Username : null });
  } catch (e) { fail(res, e); }
};

/* Creates the login if the student has none, otherwise resets to a new temporary password. */
const resetPassword = async (req, res) => {
  try {
    const db = await getConnection();
    const st = await loadStudent(db, req.params.id);
    if (!st) return res.status(404).json({ message: "Student not found." });
    const u = await db.query("SELECT UserId, Username FROM Users WHERE StudentID = ? AND Role = 'Student'", [st.StudentID]);
    let out;
    if (!u.length) out = await createStudentLogin(db, st);
    else out = await resetStudentPassword(db, st, u[0].UserId, u[0].Username);
    res.json({ message: u.length ? "Password reset. Send the new temporary password to the student." : "Login created.", username: out.username, password: out.password, whatsappUrl: out.whatsappUrl || null, whatsappError: out.whatsappError || null });
  } catch (e) { fail(res, e); }
};

/* Existing students that have no login yet. */
const createMissingLogins = async (req, res) => {
  try {
    const db = await getConnection();
    const rows = await db.query("SELECT st.StudentID, st.RollNumber, st.Name, st.ParentPhone FROM Students st WHERE NOT EXISTS (SELECT 1 FROM Users u WHERE u.StudentID = st.StudentID)");
    const created = [];
    for (const st of rows) {
      try {
        const l = await createStudentLogin(db, st);
        if (l.created) created.push({ studentId: Number(st.StudentID), name: st.Name, roll: st.RollNumber, username: l.username, password: l.password, whatsappUrl: l.whatsappUrl || null });
      } catch (e) { console.error("[bulk login]", e.message); }
    }
    res.json({ message: `${created.length} login(s) created.`, created });
  } catch (e) { fail(res, e); }
};

module.exports = { addStudent, getStudents, updateStudent, deleteStudent, getMe, getAccounts, linkAccount, importStudents, getMyAttendanceSummary, getMyTimetable, getLoginInfo, resetPassword, createMissingLogins };
