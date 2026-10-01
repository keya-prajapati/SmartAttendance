const { getConnection } = require("../config/db");
const { getLinkedStudentId, isValidDate, todayString, normalizeStatus } = require("../config/helpers");
const { buildAbsentMessage, whatsappUrl, openWhatsApp, toIntlPhone, whatsappMode, isAutoWhatsAppConfigured } = require("../config/whatsappService");
const { parseFile, pickField, parseDate, parseTime, parseDateTime } = require("../config/importParser");
const { parseClassNumber } = require("../config/schema");

const fail = (res, err) => { console.error("[API ERROR]", err.message); res.status(500).json({ message: `Database error: ${err.message}`, error: err.message }); };
const roleOf = (req) => String(req.user.role).toLowerCase();
const T = (col) => `CONVERT(VARCHAR(5), ${col}, 108)`;
const isDupError = (e) => /2601|2627|duplicate key/i.test(String(e && e.message));

/* Full attendance row, joined with every related table. Legacy rows (no lecture data) still appear. */
const REPORT_SELECT = `
  SELECT a.AttendanceID, a.StudentID, st.RollNumber, st.Name, st.ParentName, st.ParentPhone,
         COALESCE(c.ClassNumber, TRY_CAST(st.Class AS INT)) AS Class,
         COALESCE(sec.SectionName, st.Section) AS Section,
         sub.SubjectName AS Subject, a.TeacherUserID AS TeacherID, u.FullName AS TeacherName,
         a.AssignmentID, a.Period, ${T("a.LectureStartTime")} AS LectureStartTime, ${T("a.LectureEndTime")} AS LectureEndTime,
         CONVERT(VARCHAR(10), a.[Date], 23) AS Date,
         CONVERT(VARCHAR(19), a.AttendanceTakenAt, 120) AS AttendanceTakenAt,
         CONVERT(VARCHAR(19), a.CreatedAt, 120) AS CreatedAt,
         a.Status, a.Source
  FROM Attendance a
  JOIN Students st ON st.StudentID = a.StudentID
  LEFT JOIN Classes c ON c.ClassID = COALESCE(a.ClassID, st.ClassID)
  LEFT JOIN Sections sec ON sec.SectionID = COALESCE(a.SectionID, st.SectionID)
  LEFT JOIN Subjects sub ON sub.SubjectID = a.SubjectID
  LEFT JOIN Users u ON u.UserId = a.TeacherUserID`;

/* Builds WHERE from query filters + role scope. */
function reportWhere(req) {
  const q = req.query, w = [], p = [];
  if (q.date) { w.push("CONVERT(date, a.[Date]) = ?"); p.push(q.date); }
  if (q.from) { w.push("CONVERT(date, a.[Date]) >= ?"); p.push(q.from); }
  if (q.to) { w.push("CONVERT(date, a.[Date]) <= ?"); p.push(q.to); }
  if (q.classId) { w.push("COALESCE(a.ClassID, st.ClassID) = ?"); p.push(q.classId); }
  if (q.class) { w.push("c.ClassNumber = ?"); p.push(parseClassNumber(q.class) || 0); }
  if (q.sectionId) { w.push("COALESCE(a.SectionID, st.SectionID) = ?"); p.push(q.sectionId); }
  if (q.section) { w.push("sec.SectionName = ?"); p.push(String(q.section).toUpperCase()); }
  if (q.subjectId) { w.push("a.SubjectID = ?"); p.push(q.subjectId); }
  if (q.teacherId) { w.push("a.TeacherUserID = ?"); p.push(q.teacherId); }
  if (q.period) { w.push("a.Period = ?"); p.push(q.period); }
  if (q.studentId) { w.push("a.StudentID = ?"); p.push(q.studentId); }
  if (q.q) { w.push("(st.Name LIKE ? OR st.RollNumber LIKE ?)"); p.push(`%${q.q}%`, `%${q.q}%`); }
  const st = normalizeStatus(q.status);
  if (st) { w.push("a.Status = ?"); p.push(st); }
  const role = roleOf(req);
  if (role === "teacher") {
    w.push("(EXISTS (SELECT 1 FROM TeacherAssignments ta WHERE ta.TeacherUserID = ? AND ta.ClassID = COALESCE(a.ClassID, st.ClassID) AND ta.SectionID = COALESCE(a.SectionID, st.SectionID)) OR EXISTS (SELECT 1 FROM TimetableEntries te WHERE te.TimetableEntryID = a.TimetableEntryID AND te.TeacherUserID = ? AND te.ClassID = COALESCE(a.ClassID, st.ClassID) AND te.SectionID = COALESCE(a.SectionID, st.SectionID)))");
    p.push(req.user.userId, req.user.userId);
  }
  return { where: w.length ? "WHERE " + w.join(" AND ") : "", params: p };
}

const getAttendanceReport = async (req, res) => {
  try {
    if (roleOf(req) === "student") return res.status(403).json({ message: "Use /attendance/my." });
    const db = await getConnection();
    const { where, params } = reportWhere(req);
    res.json(await db.query(`${REPORT_SELECT} ${where} ORDER BY a.[Date] DESC, a.Period, st.Name`, params));
  } catch (e) { fail(res, e); }
};

/* Statistics computed by SQL Server over the same filters. */
const getAttendanceSummary = async (req, res) => {
  try {
    if (roleOf(req) === "student") return res.status(403).json({ message: "Forbidden." });
    const db = await getConnection();
    const { where, params } = reportWhere(req);
    const r = await db.query(
      `SELECT COUNT(*) AS Total,
              SUM(CASE WHEN a.Status='Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status='Absent' THEN 1 ELSE 0 END) AS Absent
       FROM Attendance a
       JOIN Students st ON st.StudentID = a.StudentID
       LEFT JOIN Classes c ON c.ClassID = COALESCE(a.ClassID, st.ClassID)
       LEFT JOIN Sections sec ON sec.SectionID = COALESCE(a.SectionID, st.SectionID)
       ${where}`, params);
    const total = Number(r[0].Total) || 0, present = Number(r[0].Present) || 0, absent = Number(r[0].Absent) || 0;
    res.json({ total, present, absent, percentage: total ? Math.round((present / total) * 1000) / 10 : null });
  } catch (e) { fail(res, e); }
};

const getAttendanceConfig = async (req, res) => {
  try {
    const threshold = Number(process.env.ATTENDANCE_LOW_THRESHOLD || 75);
    res.json({
      lowAttendanceThreshold: Number.isFinite(threshold) ? threshold : 75,
      whatsappMode: whatsappMode(),
      automatedWhatsAppEnabled: isAutoWhatsAppConfigured(),
      clickToSendLabel: "Notify All Absent Parents via WhatsApp (click-to-send)",
    });
  } catch (e) { fail(res, e); }
};

const getAttendanceAnalytics = async (req, res) => {
  try {
    if (roleOf(req) === "student") return res.status(403).json({ message: "Forbidden." });
    const db = await getConnection();
    const { where, params } = reportWhere(req);
    const rosterFilters = ["st.IsActive = 1"];
    const rosterParams = [];
    const rosterTeacherId = roleOf(req) === "teacher" ? req.user.userId : req.query.teacherId;
    if (rosterTeacherId) {
      rosterFilters.push("EXISTS (SELECT 1 FROM TeacherAssignments rosterTa WHERE rosterTa.TeacherUserID = ? AND rosterTa.ClassID = st.ClassID AND rosterTa.SectionID = st.SectionID)");
      rosterParams.push(rosterTeacherId);
    }
    if (req.query.classId) { rosterFilters.push("st.ClassID = ?"); rosterParams.push(req.query.classId); }
    if (req.query.class) { rosterFilters.push("c.ClassNumber = ?"); rosterParams.push(parseClassNumber(req.query.class) || 0); }
    if (req.query.sectionId) { rosterFilters.push("st.SectionID = ?"); rosterParams.push(req.query.sectionId); }
    if (req.query.section) { rosterFilters.push("sec.SectionName = ?"); rosterParams.push(String(req.query.section).toUpperCase()); }
    if (req.query.q) { rosterFilters.push("(st.Name LIKE ? OR st.RollNumber LIKE ?)"); rosterParams.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const roster = await db.query(
      `SELECT COUNT(DISTINCT st.StudentID) AS TotalStudents
       FROM Students st
       LEFT JOIN Classes c ON c.ClassID = st.ClassID
       LEFT JOIN Sections sec ON sec.SectionID = st.SectionID
       ${rosterFilters.length ? `WHERE ${rosterFilters.join(" AND ")}` : ""}`,
      rosterParams
    );
    const baseTable = `Attendance a JOIN Students st ON st.StudentID = a.StudentID LEFT JOIN Classes c ON c.ClassID = COALESCE(a.ClassID, st.ClassID) LEFT JOIN Sections sec ON sec.SectionID = COALESCE(a.SectionID, st.SectionID)`;
    const totals = await db.query(
      `SELECT COUNT(*) AS Total,
              SUM(CASE WHEN a.Status = 'Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status = 'Absent' THEN 1 ELSE 0 END) AS Absent
       FROM ${baseTable} ${where}`,
      params
    );
    const classSection = await db.query(
      `SELECT COALESCE(c.ClassNumber, TRY_CAST(st.Class AS INT)) AS ClassNumber,
              COALESCE(sec.SectionName, st.Section) AS SectionName,
              COUNT(DISTINCT st.StudentID) AS TotalStudents,
              SUM(CASE WHEN a.Status='Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status='Absent' THEN 1 ELSE 0 END) AS Absent
       FROM ${baseTable} ${where}
       GROUP BY COALESCE(c.ClassNumber, TRY_CAST(st.Class AS INT)), COALESCE(sec.SectionName, st.Section)
       ORDER BY ClassNumber, SectionName`,
      params
    );
    const dateSummary = await db.query(
      `SELECT CONVERT(VARCHAR(10), a.[Date], 23) AS Date,
              SUM(CASE WHEN a.Status='Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status='Absent' THEN 1 ELSE 0 END) AS Absent,
              COUNT(*) AS Marked
       FROM ${baseTable} ${where}
       GROUP BY CONVERT(VARCHAR(10), a.[Date], 23)
       ORDER BY Date DESC`,
      params
    );
    const monthlySummary = await db.query(
      `SELECT YEAR(a.[Date]) AS YearValue,
              MONTH(a.[Date]) AS MonthValue,
              SUM(CASE WHEN a.Status='Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status='Absent' THEN 1 ELSE 0 END) AS Absent,
              COUNT(*) AS Marked
       FROM ${baseTable} ${where}
       GROUP BY YEAR(a.[Date]), MONTH(a.[Date])
       ORDER BY YearValue DESC, MonthValue DESC`,
      params
    );
    const studentSummary = await db.query(
      `SELECT st.StudentID,
              st.RollNumber,
              st.Name,
              COALESCE(c.ClassNumber, TRY_CAST(st.Class AS INT)) AS ClassNumber,
              COALESCE(sec.SectionName, st.Section) AS SectionName,
              COUNT(*) AS Total,
              SUM(CASE WHEN a.Status='Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status='Absent' THEN 1 ELSE 0 END) AS Absent
       FROM ${baseTable} ${where}
       GROUP BY st.StudentID, st.RollNumber, st.Name, COALESCE(c.ClassNumber, TRY_CAST(st.Class AS INT)), COALESCE(sec.SectionName, st.Section)
       ORDER BY st.Name`,
      params
    );
    const total = Number(totals[0]?.Total) || 0;
    const present = Number(totals[0]?.Present) || 0;
    const absent = Number(totals[0]?.Absent) || 0;
    res.json({
      totalStudents: Number(roster[0]?.TotalStudents) || 0,
      total,
      present,
      absent,
      percentage: total ? Math.round((present / total) * 1000) / 10 : null,
      classSection: classSection.map((r) => ({
        classNumber: r.ClassNumber,
        sectionName: r.SectionName,
        totalStudents: Number(r.TotalStudents) || 0,
        present: Number(r.Present) || 0,
        absent: Number(r.Absent) || 0,
        percentage: (Number(r.Present) || 0) + (Number(r.Absent) || 0) ? Math.round(((Number(r.Present) || 0) / ((Number(r.Present) || 0) + (Number(r.Absent) || 0))) * 1000) / 10 : null,
      })),
      dateSummary: dateSummary.map((r) => ({
        date: r.Date,
        present: Number(r.Present) || 0,
        absent: Number(r.Absent) || 0,
        marked: Number(r.Marked) || 0,
        percentage: Number(r.Marked) ? Math.round(((Number(r.Present) || 0) / Number(r.Marked)) * 1000) / 10 : null,
      })),
      monthlySummary: monthlySummary.map((r) => ({
        year: Number(r.YearValue),
        month: Number(r.MonthValue),
        present: Number(r.Present) || 0,
        absent: Number(r.Absent) || 0,
        marked: Number(r.Marked) || 0,
        percentage: Number(r.Marked) ? Math.round(((Number(r.Present) || 0) / Number(r.Marked)) * 1000) / 10 : null,
      })),
      studentSummary: studentSummary.map((r) => ({
        studentId: r.StudentID,
        rollNumber: r.RollNumber,
        name: r.Name,
        classNumber: r.ClassNumber,
        sectionName: r.SectionName,
        total: Number(r.Total) || 0,
        present: Number(r.Present) || 0,
        absent: Number(r.Absent) || 0,
        percentage: Number(r.Total) ? Math.round((Number(r.Present) / Number(r.Total)) * 1000) / 10 : null,
      })),
    });
  } catch (e) { fail(res, e); }
};

const getLowAttendance = async (req, res) => {
  try {
    if (roleOf(req) === "student") return res.status(403).json({ message: "Forbidden." });
    const db = await getConnection();
    const threshold = Number(req.query.threshold ?? process.env.ATTENDANCE_LOW_THRESHOLD ?? 75);
    const { where, params } = reportWhere(req);
    const safeThreshold = Number.isFinite(threshold) ? threshold : 75;
    const whereClause = where ? `${where} AND st.IsActive = 1` : "WHERE st.IsActive = 1";
    const rows = await db.query(
      `SELECT st.StudentID, st.RollNumber, st.Name,
              COALESCE(c.ClassNumber, TRY_CAST(st.Class AS INT)) AS ClassNumber,
              COALESCE(sec.SectionName, st.Section) AS SectionName,
              COUNT(a.AttendanceID) AS Total,
              SUM(CASE WHEN a.Status='Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status='Absent' THEN 1 ELSE 0 END) AS Absent
       FROM Students st
       LEFT JOIN Attendance a ON a.StudentID = st.StudentID
       LEFT JOIN Classes c ON c.ClassID = COALESCE(a.ClassID, st.ClassID)
       LEFT JOIN Sections sec ON sec.SectionID = COALESCE(a.SectionID, st.SectionID)
       ${whereClause}
       GROUP BY st.StudentID, st.RollNumber, st.Name, COALESCE(c.ClassNumber, TRY_CAST(st.Class AS INT)), COALESCE(sec.SectionName, st.Section)
       HAVING COUNT(a.AttendanceID) > 0
       ORDER BY st.Name`,
      params
    );
    const low = rows
      .map((r) => {
        const total = Number(r.Total) || 0;
        const present = Number(r.Present) || 0;
        const absent = Number(r.Absent) || 0;
        const percentage = total ? Math.round((present / total) * 1000) / 10 : null;
        return { studentId: r.StudentID, rollNumber: r.RollNumber, name: r.Name, classNumber: r.ClassNumber, sectionName: r.SectionName, present, absent, total, percentage, belowThreshold: percentage !== null && percentage < safeThreshold, status: percentage !== null && percentage < safeThreshold ? "Warning" : "Normal" };
      })
      .filter((r) => r.belowThreshold)
      .sort((a, b) => (a.percentage ?? 100) - (b.percentage ?? 100));
    res.json({ threshold: safeThreshold, count: low.length, students: low });
  } catch (e) { fail(res, e); }
};

/* ---- export: same filters as the report, returns CSV or XLSX ---- */
const EXPORT_HEAD = ["Date", "Roll Number", "Student Name", "Class", "Section", "Subject", "Teacher", "Period", "Lecture Start Time", "Lecture End Time", "Status", "Parent Name", "Parent Phone", "Attendance Taken At"];
const safeName = (v) => String(v || "").replace(/[^A-Za-z0-9-]/g, "");
const exportAttendance = async (req, res) => {
  try {
    if (roleOf(req) === "student") return res.status(403).json({ message: "Forbidden." });
    const db = await getConnection();
    const { where, params } = reportWhere(req);
    const rows = await db.query(`${REPORT_SELECT} ${where} ORDER BY a.[Date] DESC, a.Period, st.RollNumber`, params);
    const data = rows.map((r) => [r.Date, r.RollNumber, r.Name, r.Class, r.Section, r.Subject, r.TeacherName, r.Period, r.LectureStartTime, r.LectureEndTime, r.Status, r.ParentName, r.ParentPhone, r.AttendanceTakenAt].map((v) => (v === null || v === undefined ? "" : v)));
    const f = rows[0] || {};
    const same = (k) => rows.length && rows.every((r) => r[k] === f[k]);
    const dateTag = req.query.date || (req.query.from || req.query.to ? `${req.query.from || "start"}_to_${req.query.to || "now"}` : same("Date") ? f.Date : "All");
    const base = ["Attendance", same("Class") && f.Class ? `Class${f.Class}` : null, same("Section") && f.Section ? safeName(f.Section) : null, same("Subject") && f.Subject ? safeName(f.Subject) : null, dateTag].filter(Boolean).join("_");
    const fmt = String(req.query.format || "xlsx").toLowerCase();
    if (fmt === "csv") {
      const cell = (v) => { let t = String(v); if (/^[=+\-@]/.test(t)) t = `'${t}`; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const text = "\uFEFF" + [EXPORT_HEAD, ...data].map((r) => r.map(cell).join(",")).join("\r\n");
      res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Access-Control-Expose-Headers": "Content-Disposition" });
      return res.send(text);
    }
    const XLSX = require("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEAD, ...data]);
    ws["!cols"] = EXPORT_HEAD.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Attendance");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.set({ "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Access-Control-Expose-Headers": "Content-Disposition" });
    res.send(buf);
  } catch (e) { fail(res, e); }
};

/* ---- per-student history over the same filters ---- */
const studentHistory = async (req, res) => {
  try {
    if (roleOf(req) === "student") return res.status(403).json({ message: "Forbidden." });
    const db = await getConnection();
    const { where, params } = reportWhere(req);
    const r = await db.query(
      `SELECT st.StudentID, st.RollNumber, st.Name, COUNT(*) AS Total,
              SUM(CASE WHEN a.Status='Present' THEN 1 ELSE 0 END) AS Present,
              SUM(CASE WHEN a.Status='Absent' THEN 1 ELSE 0 END) AS Absent
       FROM Attendance a
       JOIN Students st ON st.StudentID = a.StudentID
       LEFT JOIN Classes c ON c.ClassID = COALESCE(a.ClassID, st.ClassID)
       LEFT JOIN Sections sec ON sec.SectionID = COALESCE(a.SectionID, st.SectionID)
       ${where} GROUP BY st.StudentID, st.RollNumber, st.Name ORDER BY st.Name`, params);
    res.json(r.map((x) => ({ studentId: x.StudentID, rollNumber: x.RollNumber, name: x.Name, total: Number(x.Total), present: Number(x.Present), absent: Number(x.Absent), percentage: x.Total ? Math.round((Number(x.Present) / Number(x.Total)) * 1000) / 10 : null })));
  } catch (e) { fail(res, e); }
};

/* Student: ONLY the student linked to the JWT user. */
const getMyAttendance = async (req, res) => {
  try {
    const id = await getLinkedStudentId(req.user.userId);
    if (id === null) return res.status(404).json({ message: "Your account is not linked to a student record yet.", code: "NOT_LINKED" });
    const db = await getConnection();
    res.json(await db.query(`${REPORT_SELECT} WHERE a.StudentID = ? AND st.IsActive = 1 ORDER BY a.[Date] DESC, a.Period`, [id]));
  } catch (e) { fail(res, e); }
};

/* ---------- core: save one student's lecture attendance ----------
   returns "inserted" | "updated" | "unchanged" | "duplicate" | throws */
async function saveOne(db, { asg, studentId, date, status, source, takenAt, allowUpdate, timetableEntryId = null }) {
  const ex = await db.query(
    "SELECT AttendanceID, Status, TimetableEntryID FROM Attendance WHERE StudentID = ? AND CONVERT(date,[Date]) = ? AND ClassID = ? AND SectionID = ? AND SubjectID = ? AND Period = ?",
    [studentId, date, asg.ClassID, asg.SectionID, asg.SubjectID, asg.Period]);
  if (ex.length) {
    if (ex[0].Status === status) {
      if (timetableEntryId && ex[0].TimetableEntryID == null) await db.query("UPDATE Attendance SET TimetableEntryID = ? WHERE AttendanceID = ?", [timetableEntryId, ex[0].AttendanceID]);
      return "unchanged";
    }
    if (!allowUpdate) return "duplicate";
    if (timetableEntryId) {
      await db.query("UPDATE Attendance SET Status = ?, TimetableEntryID = COALESCE(TimetableEntryID, ?), UpdatedAt = SYSDATETIME() WHERE AttendanceID = ?", [status, timetableEntryId, ex[0].AttendanceID]);
    } else {
      await db.query("UPDATE Attendance SET Status = ?, UpdatedAt = SYSDATETIME() WHERE AttendanceID = ?", [status, ex[0].AttendanceID]);
    }
    return "updated";
  }
  // ---- ODBC-safe INSERT: every number / date / time is validated, then written as a SQL literal ----
  const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${name}: ${v}`); return n; };
  const hms = (v, name) => {
    const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] || 0) > 59) throw new Error(`Invalid ${name}: ${v}`);
    return `${m[1].padStart(2, "0")}:${m[2]}:${(m[3] || "00").padStart(2, "0")}`;
  };
  const sid = int(studentId, "StudentID"), classId = int(asg.ClassID, "ClassID"), sectionId = int(asg.SectionID, "SectionID");
  const subjectId = int(asg.SubjectID, "SubjectID"), teacherUserId = int(asg.TeacherUserID, "TeacherUserID");
  const assignmentId = asg.AssignmentID == null ? null : int(asg.AssignmentID, "AssignmentID");
  const scheduleEntryId = timetableEntryId == null ? null : int(timetableEntryId, "TimetableEntryID");
  const period = int(asg.Period, "Period");
  const startTime = hms(asg.StartTime, "LectureStartTime"), endTime = hms(asg.EndTime, "LectureEndTime");
  const d = String(date || "").slice(0, 10);
  if (!isValidDate(d)) throw new Error(`Invalid date: ${date}`);
  if (status !== "Present" && status !== "Absent") throw new Error(`Invalid status: ${status}`);
  const src = source === "Import" ? "Import" : "Manual";
  const assignmentSql = assignmentId == null ? "NULL" : String(assignmentId);
  const timetableEntrySql = scheduleEntryId == null ? "NULL" : String(scheduleEntryId);
  let takenSql = "SYSDATETIME()";
  if (takenAt) {
    const t = String(takenAt).replace("T", " ").slice(0, 19);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) throw new Error(`Invalid AttendanceTakenAt: ${takenAt}`);
    takenSql = `CAST('${t}' AS DATETIME2(0))`;
  }
  console.log("[ATTENDANCE INSERT]", { studentId: sid, date: d, status, classId, sectionId, subjectId, teacherUserId, assignmentId, period, startTime, endTime, source: src });
  await db.query(
    `INSERT INTO Attendance (StudentID, [Date], Status, ClassID, SectionID, SubjectID, TeacherUserID, AssignmentID, TimetableEntryID, Period, LectureStartTime, LectureEndTime, AttendanceTakenAt, CreatedAt, Source)
     VALUES (${sid}, CAST('${d}' AS DATE), '${status}', ${classId}, ${sectionId}, ${subjectId}, ${teacherUserId}, ${assignmentSql}, ${timetableEntrySql}, ${period}, CAST('${startTime}' AS TIME(0)), CAST('${endTime}' AS TIME(0)), ${takenSql}, SYSDATETIME(), '${src}')`);
  return "inserted";
}

const ASG_SQL = `SELECT ta.AssignmentID, ta.TeacherUserID, ta.ClassID, ta.SectionID, ta.SubjectID, ta.Period,
  ${T("ta.StartTime")} AS StartTime, ${T("ta.EndTime")} AS EndTime, c.ClassNumber, s.SectionName, sub.SubjectName
  FROM TeacherAssignments ta JOIN Classes c ON c.ClassID = ta.ClassID JOIN Sections s ON s.SectionID = ta.SectionID JOIN Subjects sub ON sub.SubjectID = ta.SubjectID`;

const TIMETABLE_SQL = `SELECT te.TimetableEntryID, te.DayOfWeek, te.TeacherUserID, te.ClassID, te.SectionID, te.SubjectID, te.Period,
  ${T("te.StartTime")} AS StartTime, ${T("te.EndTime")} AS EndTime, c.ClassNumber, s.SectionName, sub.SubjectName
  FROM TimetableEntries te JOIN Classes c ON c.ClassID = te.ClassID JOIN Sections s ON s.SectionID = te.SectionID AND s.ClassID = te.ClassID JOIN Subjects sub ON sub.SubjectID = te.SubjectID`;

function notification(stu, asg, date) {
  const message = buildAbsentMessage({ name: stu.Name, date, classNumber: asg.ClassNumber, section: asg.SectionName, subject: asg.SubjectName, period: asg.Period, start: asg.StartTime, end: asg.EndTime });
  return { studentId: Number(stu.StudentID), name: stu.Name, parentName: stu.ParentName || null, phone: stu.ParentPhone, message, validPhone: !!toIntlPhone(stu.ParentPhone), url: whatsappUrl(stu.ParentPhone, message) };
}

/* POST /attendance/mark-bulk  { assignmentId, date, records:[{studentId,status}] }
   Legacy (no assignmentId): Admin only, date-level upsert exactly like before. */
const markBulk = async (req, res) => {
  const { assignmentId, timetableEntryId, date, records } = req.body;
  if (assignmentId && timetableEntryId) return res.status(400).json({ message: "Choose either a legacy assignment or a timetable entry, not both." });
  if (!isValidDate(date)) return res.status(400).json({ message: "A valid date (YYYY-MM-DD) is required." });
  if (date > todayString()) return res.status(400).json({ message: "Attendance cannot be marked for a future date." });
  if (!Array.isArray(records) || !records.length) return res.status(400).json({ message: "No attendance records supplied." });
  try {
    const db = await getConnection();
    const admin = roleOf(req) === "admin";

    if (!assignmentId && !timetableEntryId) {
      if (!admin) return res.status(400).json({ message: "Select an assigned class/lecture before marking attendance." });
      const failed = []; let saved = 0; const notifications = [];
      for (const r of records) {
        const status = normalizeStatus(r.status);
        if (!status) { failed.push({ studentId: r.studentId, reason: "Invalid status." }); continue; }
        try {
          const s = await db.query("SELECT Name, ParentPhone FROM Students WHERE StudentID = ? AND IsActive = 1", [r.studentId]);
          if (!s.length) { failed.push({ studentId: r.studentId, reason: "Student not found." }); continue; }
          const ex = await db.query("SELECT AttendanceID FROM Attendance WHERE StudentID = ? AND CONVERT(date,[Date]) = ? AND Period IS NULL", [r.studentId, date]);
          if (ex.length) await db.query("UPDATE Attendance SET Status = ?, UpdatedAt = SYSDATETIME() WHERE AttendanceID = ?", [status, ex[0].AttendanceID]);
          else await db.query("INSERT INTO Attendance (StudentID, [Date], Status, CreatedAt, AttendanceTakenAt, Source) VALUES (?, ?, ?, SYSDATETIME(), SYSDATETIME(), 'Manual')", [r.studentId, date, status]);
          saved++;
          if (status === "Absent") notifications.push({ studentId: Number(r.studentId), name: s[0].Name, phone: s[0].ParentPhone, url: openWhatsApp(s[0].ParentPhone, s[0].Name, date) });
        } catch (e) { failed.push({ studentId: r.studentId, reason: e.message }); }
      }
      return res.json({ message: `Attendance saved for ${saved} student(s).`, saved, failed, notifications });
    }

    let asg;
    let scheduleId = null;
    if (timetableEntryId) {
      scheduleId = Number(timetableEntryId);
      if (!Number.isInteger(scheduleId) || scheduleId < 1) return res.status(400).json({ message: "Invalid timetable entry ID." });
      const scheduled = await db.query(`${TIMETABLE_SQL} WHERE te.TimetableEntryID = ?`, [scheduleId]);
      if (!scheduled.length) return res.status(404).json({ message: "Timetable entry not found." });
      asg = { ...scheduled[0], AssignmentID: null, TimetableEntryID: scheduleId };
      if (!admin && Number(asg.TeacherUserID) !== Number(req.user.userId)) return res.status(403).json({ message: "This timetable entry is not assigned to you." });
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || Number(asg.DayOfWeek) !== weekday) return res.status(400).json({ message: "The selected date does not match this timetable day." });
    } else {
      const a = await db.query(`${ASG_SQL} WHERE ta.AssignmentID = ?`, [assignmentId]);
      if (!a.length) return res.status(404).json({ message: "Assignment not found." });
      asg = a[0];
      if (!admin && Number(asg.TeacherUserID) !== Number(req.user.userId)) return res.status(403).json({ message: "This class is not assigned to you." });
    }
    // teachers may edit a lecture's attendance only on the day it was taken; admin any day
    const allowUpdate = admin || date === todayString();

    const out = { inserted: 0, updated: 0, unchanged: 0, duplicates: 0 }, failed = [], notifications = [];
    for (const r of records) {
      const status = normalizeStatus(r.status);
      if (!status) { failed.push({ studentId: r.studentId, reason: "Status must be Present or Absent." }); continue; }
      try {
        const s = await db.query("SELECT StudentID, Name, ParentName, ParentPhone, ClassID, SectionID FROM Students WHERE StudentID = ? AND IsActive = 1", [r.studentId]);
        if (!s.length) { failed.push({ studentId: r.studentId, reason: "Student not found." }); continue; }
        if (Number(s[0].ClassID) !== Number(asg.ClassID) || Number(s[0].SectionID) !== Number(asg.SectionID)) {
          failed.push({ studentId: r.studentId, reason: `${s[0].Name} does not belong to Class ${asg.ClassNumber}-${asg.SectionName}.` }); continue;
        }
        let result;
        try { result = await saveOne(db, { asg, studentId: r.studentId, date, status, source: "Manual", allowUpdate, timetableEntryId: scheduleId }); }
        catch (e) { if (isDupError(e)) result = "duplicate"; else throw e; }
        if (result === "inserted") out.inserted++;
        else if (result === "updated") out.updated++;
        else if (result === "unchanged") out.unchanged++;
        else { out.duplicates++; failed.push({ studentId: r.studentId, reason: `Attendance already exists for ${s[0].Name} in this lecture; it can only be edited by the teacher on the same day (or by an Admin).` }); }
        if (status === "Absent" && (result === "inserted" || result === "updated")) notifications.push(notification(s[0], asg, date));
      } catch (e) { failed.push({ studentId: r.studentId, reason: e.message }); }
    }
    const saved = out.inserted + out.updated;
    res.json({
      message: `Attendance saved: ${out.inserted} new, ${out.updated} updated, ${out.unchanged} already recorded` + (failed.length ? `, ${failed.length} failed.` : "."),
      saved, ...out, failed, notifications,
    });
  } catch (e) { fail(res, e); }
};

/* Legacy single mark - kept for backward compatibility (Admin / date-level). */
const markAttendance = async (req, res) => {
  const { studentId, date, status, assignmentId } = req.body;
  req.body = { assignmentId, date, records: [{ studentId, status }] };
  if (!studentId || !date || !status) return res.status(400).json({ message: "Student ID, date, and status are required." });
  const orig = res.json.bind(res);
  res.json = (b) => orig(b && b.notifications ? { ...b, whatsappTriggered: b.notifications.length > 0, whatsappUrl: b.notifications[0]?.url || null } : b);
  return markBulk(req, res);
};

/* GET /attendance/absent-notifications?date=&assignmentId=&summary=true  -> WhatsApp links for absent students of a lecture */
const absentNotifications = async (req, res) => {
  try {
    const db = await getConnection();
    const { assignmentId, timetableEntryId } = req.query;
    const date = req.query.date || todayString();
    if ((!assignmentId && !timetableEntryId) || (assignmentId && timetableEntryId)) return res.status(400).json({ message: "Provide exactly one of assignmentId or timetableEntryId." });
    let asg;
    let rows;
    if (timetableEntryId) {
      const entryId = Number(timetableEntryId);
      if (!Number.isInteger(entryId) || entryId < 1) return res.status(400).json({ message: "Invalid timetable entry ID." });
      const scheduled = await db.query(`${TIMETABLE_SQL} WHERE te.TimetableEntryID = ?`, [entryId]);
      if (!scheduled.length) return res.status(404).json({ message: "Timetable entry not found." });
      asg = { ...scheduled[0], AssignmentID: null, TimetableEntryID: entryId };
      if (roleOf(req) === "teacher" && Number(asg.TeacherUserID) !== Number(req.user.userId)) return res.status(403).json({ message: "This timetable entry is not assigned to you." });
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || Number(asg.DayOfWeek) !== weekday) return res.status(400).json({ message: "The selected date does not match this timetable day." });
      rows = await db.query(
        `SELECT st.StudentID, st.Name, st.ParentName, st.ParentPhone FROM Attendance at JOIN Students st ON st.StudentID = at.StudentID
         WHERE at.TimetableEntryID = ? AND CONVERT(date, at.[Date]) = ? AND at.Status = 'Absent'`, [entryId, date]);
    } else {
      const assignments = await db.query(`${ASG_SQL} WHERE ta.AssignmentID = ?`, [assignmentId]);
      if (!assignments.length) return res.status(404).json({ message: "Assignment not found." });
      asg = assignments[0];
      if (roleOf(req) === "teacher" && Number(asg.TeacherUserID) !== Number(req.user.userId)) return res.status(403).json({ message: "This class is not assigned to you." });
      rows = await db.query(
        `SELECT st.StudentID, st.Name, st.ParentName, st.ParentPhone FROM Attendance at JOIN Students st ON st.StudentID = at.StudentID
         WHERE at.AssignmentID = ? AND CONVERT(date, at.[Date]) = ? AND at.Status = 'Absent'`, [assignmentId, date]);
    }
    const notifications = rows.map((s) => notification(s, asg, date));
    const validPhone = notifications.filter((n) => n.validPhone && n.url).length;
    const invalidPhone = notifications.length - validPhone;
    const summary = {
      totalAbsent: notifications.length,
      validPhone,
      invalidPhone,
      missingPhone: notifications.filter((n) => !n.phone || !n.validPhone).length,
      processed: validPhone,
      failed: invalidPhone,
      mode: "click_to_send",
      label: "Notify All Absent Parents via WhatsApp (click-to-send)",
      message: "This uses the existing wa.me links. WhatsApp still requires the teacher to tap Send in the app unless a separate WhatsApp API is configured.",
      notifications,
    };
    if (req.query.summary === "true" || req.query.summary === "1") return res.json(summary);
    res.json(notifications);
  } catch (e) { fail(res, e); }
};

/* ---------------- bulk attendance import ---------------- */
const importAttendance = async (req, res) => {
  let rows;
  try { rows = parseFile(req.body.filename, req.body.contentBase64); }
  catch (e) { return res.status(400).json({ message: e.message }); }
  try {
    const db = await getConnection();
    const admin = roleOf(req) === "admin";
    const result = { total: rows.length, imported: 0, failed: 0, duplicates: 0, failures: [], duplicateRows: [], notifications: [] };
    for (const r of rows) {
      await (async () => {
      const bad = (reason) => { result.failed++; result.failures.push({ row: r.__row, reason }); };
      try {
        const sid = String(pickField(r, "StudentID", "Student ID")).trim();
        const roll = String(pickField(r, "RollNumber", "Roll No", "Roll")).trim();
        const cls = parseClassNumber(pickField(r, "Class"));
        const secName = String(pickField(r, "Section")).trim().toUpperCase();
        const subjName = String(pickField(r, "Subject")).trim();
        const teacherVal = String(pickField(r, "Teacher", "TeacherUsername", "TeacherName")).trim();
        const period = Number(pickField(r, "Period", "Lecture", "LecturePeriod"));
        const dateRaw = pickField(r, "Date", "AttendanceDate");
        const date = parseDate(dateRaw);
        const status = normalizeStatus(pickField(r, "Status"));
        const startRaw = pickField(r, "LectureStartTime", "StartTime"), endRaw = pickField(r, "LectureEndTime", "EndTime");
        const takenRaw = pickField(r, "AttendanceTakenAt", "TakenAt");

        if (!cls) return bad("Class is missing or not between 1 and 12.");
        if (!secName) return bad("Section is missing.");
        if (!subjName) return bad("Subject is missing.");
        if (!Number.isInteger(period) || period < 1) return bad("Lecture/Period is missing or invalid.");
        if (!date) return bad(`Invalid date "${dateRaw}".`);
        if (date > todayString()) return bad("Date is in the future.");
        if (!status) return bad("Status must be Present or Absent.");

        const c = await db.query("SELECT ClassID FROM Classes WHERE ClassNumber = ?", [cls]);
        if (!c.length) return bad(`Class ${cls} does not exist.`);
        const sec = await db.query("SELECT SectionID FROM Sections WHERE ClassID = ? AND SectionName = ?", [c[0].ClassID, secName]);
        if (!sec.length) return bad(`Section ${secName} does not exist in Class ${cls}.`);
        const sub = await db.query("SELECT SubjectID FROM Subjects WHERE SubjectName = ?", [subjName]);
        if (!sub.length) return bad(`Subject "${subjName}" does not exist.`);

        let student;
        if (/^\d+$/.test(sid)) student = await db.query("SELECT StudentID, Name, ParentPhone, ClassID, SectionID FROM Students WHERE StudentID = ?", [sid]);
        else if (roll) student = await db.query("SELECT StudentID, Name, ParentPhone, ClassID, SectionID FROM Students WHERE RollNumber = ? AND ClassID = ? AND SectionID = ?", [roll, c[0].ClassID, sec[0].SectionID]);
        else return bad("StudentID or Roll Number is required.");
        if (!student.length) return bad("Student not found.");
        const stu = student[0];
        if (Number(stu.ClassID) !== Number(c[0].ClassID) || Number(stu.SectionID) !== Number(sec[0].SectionID)) return bad(`${stu.Name} does not belong to Class ${cls}-${secName}.`);

        let teacherId;
        if (admin) {
          if (!teacherVal) return bad("Teacher is missing.");
          const t = await db.query("SELECT UserId FROM Users WHERE Role = 'Teacher' AND (Username = ? OR FullName = ?)", [teacherVal, teacherVal]);
          if (!t.length) return bad(`Teacher "${teacherVal}" not found.`);
          if (t.length > 1) return bad(`Teacher name "${teacherVal}" is ambiguous - use the username.`);
          teacherId = t[0].UserId;
        } else teacherId = req.user.userId;   // teachers can only import their own lectures

        const a = await db.query(`${ASG_SQL} WHERE ta.TeacherUserID = ? AND ta.ClassID = ? AND ta.SectionID = ? AND ta.SubjectID = ? AND ta.Period = ?`,
          [teacherId, c[0].ClassID, sec[0].SectionID, sub[0].SubjectID, period]);
        if (!a.length) return bad("No teacher assignment exists for this Teacher + Class + Section + Subject + Period.");
        const asg = a[0];

        if (startRaw !== "" && parseTime(startRaw) !== asg.StartTime) return bad(`Lecture start time does not match the assignment (${asg.StartTime}).`);
        if (endRaw !== "" && parseTime(endRaw) !== asg.EndTime) return bad(`Lecture end time does not match the assignment (${asg.EndTime}).`);
        let takenAt = null;
        if (takenRaw !== "") { takenAt = parseDateTime(takenRaw, date); if (!takenAt) return bad(`Invalid Attendance Taken At "${takenRaw}".`); }

        let outcome;
        try { outcome = await saveOne(db, { asg, studentId: stu.StudentID, date, status, source: "Import", takenAt, allowUpdate: false }); }
        catch (e) { if (isDupError(e)) outcome = "duplicate"; else throw e; }
        if (outcome === "inserted") {
          result.imported++;
          if (status === "Absent") result.notifications.push(notification(stu, asg, date));
        } else {
          result.duplicates++;
          result.duplicateRows.push({ row: r.__row, reason: `Attendance already exists for ${stu.Name} on ${date}, Period ${period}.` });
        }
      } catch (e) { bad(e.message); }
      })();
    }
    res.json({ message: `Import finished: ${result.imported} imported, ${result.duplicates} duplicate, ${result.failed} failed.`, ...result });
  } catch (e) { fail(res, e); }
};

module.exports = { exportAttendance, studentHistory, markAttendance, markBulk, getAttendanceReport, getAttendanceSummary, getAttendanceAnalytics, getLowAttendance, getAttendanceConfig, getMyAttendance, absentNotifications, importAttendance };
