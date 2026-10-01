const { getConnection } = require("../config/db");
const { isValidDate, todayString } = require("../config/helpers");

const DAYS = new Set([1, 2, 3, 4, 5, 6]);
const fail = (res, error) => {
  if (error.status) return res.status(error.status).json({ message: error.message, code: error.code });
  console.error("[TIMETABLE API ERROR]", error.message);
  return res.status(500).json({ message: "Timetable operation failed." });
};
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const conflict = (message) => Object.assign(new Error(message), { status: 409 });
const notFound = (message) => Object.assign(new Error(message), { status: 404 });

function parseEntry(body) {
  const entry = {
    classId: Number(body.classId),
    sectionId: Number(body.sectionId),
    teacherUserId: Number(body.teacherUserId),
    subjectId: Number(body.subjectId),
    dayOfWeek: Number(body.dayOfWeek),
    period: Number(body.period),
    startTime: String(body.startTime || "").trim(),
    endTime: String(body.endTime || "").trim(),
  };
  for (const key of ["classId", "sectionId", "teacherUserId", "subjectId"]) {
    if (!Number.isInteger(entry[key]) || entry[key] < 1) throw invalid(`Invalid ${key}.`);
  }
  if (!DAYS.has(entry.dayOfWeek)) throw invalid("Day must be Monday through Saturday.");
  if (!Number.isInteger(entry.period) || entry.period < 1 || entry.period > 12) throw invalid("Period must be between 1 and 12.");
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
  if (!timePattern.test(entry.startTime) || !timePattern.test(entry.endTime)) throw invalid("Enter valid start and end times.");
  if (entry.startTime >= entry.endTime) throw invalid("End time must be after start time.");
  entry.startTime = entry.startTime.length === 5 ? `${entry.startTime}:00` : entry.startTime;
  entry.endTime = entry.endTime.length === 5 ? `${entry.endTime}:00` : entry.endTime;
  return entry;
}

const ENTRY_SELECT = `
  SELECT te.TimetableEntryID, te.DayOfWeek, te.ClassID, c.ClassNumber, c.ClassName,
         te.SectionID, sec.SectionName, te.TeacherUserID, u.FullName AS TeacherName,
         te.SubjectID, sub.SubjectName, te.Period,
         CONVERT(VARCHAR(5), te.StartTime, 108) AS StartTime,
         CONVERT(VARCHAR(5), te.EndTime, 108) AS EndTime
  FROM TimetableEntries te
  JOIN Classes c ON c.ClassID = te.ClassID
  JOIN Sections sec ON sec.SectionID = te.SectionID AND sec.ClassID = te.ClassID
  JOIN Users u ON u.UserId = te.TeacherUserID AND u.Role = 'Teacher'
  JOIN Subjects sub ON sub.SubjectID = te.SubjectID`;

async function validateReferences(db, entry) {
  const section = await db.query(
    "SELECT 1 AS x FROM Sections WHERE SectionID = ? AND ClassID = ?",
    [entry.sectionId, entry.classId]
  );
  if (!section.length) throw invalid("Section does not belong to the selected class.");
  const teacher = await db.query("SELECT 1 AS x FROM Users WHERE UserId = ? AND Role = 'Teacher'", [entry.teacherUserId]);
  if (!teacher.length) throw invalid("Selected user is not a teacher.");
  const subject = await db.query("SELECT 1 AS x FROM Subjects WHERE SubjectID = ?", [entry.subjectId]);
  if (!subject.length) throw invalid("Selected subject does not exist.");
}

async function validateConflicts(db, entry, excludeId = null) {
  const periodParams = [entry.dayOfWeek, entry.period, excludeId || 0];
  const classPeriod = await db.query(
    `SELECT TOP 1 TimetableEntryID FROM TimetableEntries WITH (UPDLOCK, HOLDLOCK)
     WHERE ClassID = ? AND SectionID = ? AND DayOfWeek = ? AND Period = ? AND TimetableEntryID <> ?`,
    [entry.classId, entry.sectionId, ...periodParams]
  );
  if (classPeriod.length) throw conflict("This class and section already have an entry for that day and period.");

  const teacherPeriod = await db.query(
    `SELECT TOP 1 TimetableEntryID FROM TimetableEntries WITH (UPDLOCK, HOLDLOCK)
     WHERE TeacherUserID = ? AND DayOfWeek = ? AND Period = ? AND TimetableEntryID <> ?`,
    [entry.teacherUserId, ...periodParams]
  );
  if (teacherPeriod.length) throw conflict("This teacher already has an entry for that day and period.");

  const teacherOverlap = await db.query(
    `SELECT TOP 1 TimetableEntryID FROM TimetableEntries WITH (UPDLOCK, HOLDLOCK)
     WHERE TeacherUserID = ? AND DayOfWeek = ? AND TimetableEntryID <> ?
       AND CAST(? AS TIME(0)) < EndTime AND CAST(? AS TIME(0)) > StartTime`,
    [entry.teacherUserId, entry.dayOfWeek, excludeId || 0, entry.startTime, entry.endTime]
  );
  if (teacherOverlap.length) throw conflict("This teacher has an overlapping timetable entry.");

  const classOverlap = await db.query(
    `SELECT TOP 1 TimetableEntryID FROM TimetableEntries WITH (UPDLOCK, HOLDLOCK)
     WHERE ClassID = ? AND SectionID = ? AND DayOfWeek = ? AND TimetableEntryID <> ?
       AND CAST(? AS TIME(0)) < EndTime AND CAST(? AS TIME(0)) > StartTime`,
    [entry.classId, entry.sectionId, entry.dayOfWeek, excludeId || 0, entry.startTime, entry.endTime]
  );
  if (classOverlap.length) throw conflict("This class and section have an overlapping timetable entry.");
}

async function insertEntry(db, entry) {
  const inserted = await db.query(
    `INSERT INTO TimetableEntries (DayOfWeek, ClassID, SectionID, TeacherUserID, SubjectID, Period, StartTime, EndTime)
     OUTPUT INSERTED.TimetableEntryID AS TimetableEntryID
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS TIME(0)), CAST(? AS TIME(0)))`,
    [entry.dayOfWeek, entry.classId, entry.sectionId, entry.teacherUserId, entry.subjectId, entry.period, entry.startTime, entry.endTime]
  );
  return inserted[0].TimetableEntryID;
}

const getAdminTimetable = async (req, res) => {
  if (!req.query.classId && !req.query.sectionId) return res.json([]);
  if (!req.query.classId || !req.query.sectionId) return res.status(400).json({ message: "Select both a class and section." });
  const classId = Number(req.query.classId), sectionId = Number(req.query.sectionId);
  if (!Number.isInteger(classId) || classId < 1 || !Number.isInteger(sectionId) || sectionId < 1) return res.status(400).json({ message: "Select valid class and section IDs." });
  try {
    const db = await getConnection();
    const section = await db.query("SELECT 1 AS x FROM Sections WHERE SectionID = ? AND ClassID = ?", [sectionId, classId]);
    if (!section.length) return res.status(400).json({ message: "Section does not belong to the selected class." });
    res.json(await db.query(`${ENTRY_SELECT} WHERE te.ClassID = ? AND te.SectionID = ? ORDER BY te.DayOfWeek, te.Period`, [classId, sectionId]));
  } catch (e) { fail(res, e); }
};

const saveAdminEntry = async (req, res) => {
  let entry;
  try { entry = parseEntry(req.body); }
  catch (e) { return fail(res, e); }
  const id = req.params.id == null ? null : Number(req.params.id);
  if (id !== null && (!Number.isInteger(id) || id < 1)) return res.status(400).json({ message: "Invalid timetable entry ID." });
  try {
    const db = await getConnection();
    const savedId = await db.withTransaction(async (tx) => {
      await validateReferences(tx, entry);
      await validateConflicts(tx, entry, id);
      if (id === null) return insertEntry(tx, entry);
      const updated = await tx.query(
        `UPDATE TimetableEntries SET DayOfWeek = ?, ClassID = ?, SectionID = ?, TeacherUserID = ?, SubjectID = ?, Period = ?,
           StartTime = CAST(? AS TIME(0)), EndTime = CAST(? AS TIME(0))
         OUTPUT INSERTED.TimetableEntryID AS TimetableEntryID WHERE TimetableEntryID = ?`,
        [entry.dayOfWeek, entry.classId, entry.sectionId, entry.teacherUserId, entry.subjectId, entry.period, entry.startTime, entry.endTime, id]
      );
      if (!updated.length) throw notFound("Timetable entry not found.");
      return updated[0].TimetableEntryID;
    });
    res.status(id === null ? 201 : 200).json({ message: id === null ? "Timetable entry added." : "Timetable entry updated.", timetableEntryId: savedId });
  } catch (e) { fail(res, e); }
};

const deleteAdminEntry = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid timetable entry ID." });
  try {
    const db = await getConnection();
    await db.withTransaction(async (tx) => {
      const rows = await tx.query("SELECT TimetableEntryID FROM TimetableEntries WITH (UPDLOCK, HOLDLOCK) WHERE TimetableEntryID = ?", [id]);
      if (!rows.length) throw notFound("Timetable entry not found.");
      const history = await tx.query("SELECT COUNT(*) AS n FROM Attendance WHERE TimetableEntryID = ?", [id]);
      if (Number(history[0].n)) throw conflict("Attendance already references this timetable entry; it cannot be deleted.");
      await tx.query("DELETE FROM TimetableEntries WHERE TimetableEntryID = ?", [id]);
    });
    res.json({ message: "Timetable entry deleted." });
  } catch (e) { fail(res, e); }
};

const copyAdminTimetable = async (req, res) => {
  const sourceClassId = Number(req.body.sourceClassId), sourceSectionId = Number(req.body.sourceSectionId);
  const targetClassId = Number(req.body.targetClassId), targetSectionId = Number(req.body.targetSectionId);
  const teacherMapping = req.body.teacherMapping && typeof req.body.teacherMapping === "object" ? req.body.teacherMapping : {};
  if (![sourceClassId, sourceSectionId, targetClassId, targetSectionId].every((n) => Number.isInteger(n) && n > 0)) {
    return res.status(400).json({ message: "Select valid source and destination classes and sections." });
  }
  if (sourceClassId === targetClassId && sourceSectionId === targetSectionId) return res.status(400).json({ message: "Choose a different destination section." });
  try {
    const db = await getConnection();
    const copied = await db.withTransaction(async (tx) => {
      const sourceSection = await tx.query("SELECT 1 AS x FROM Sections WHERE SectionID = ? AND ClassID = ?", [sourceSectionId, sourceClassId]);
      const targetSection = await tx.query("SELECT 1 AS x FROM Sections WHERE SectionID = ? AND ClassID = ?", [targetSectionId, targetClassId]);
      if (!sourceSection.length || !targetSection.length) throw invalid("A selected section does not belong to its class.");
      const source = await tx.query("SELECT DayOfWeek, TeacherUserID, SubjectID, Period, StartTime, EndTime FROM TimetableEntries WITH (UPDLOCK, HOLDLOCK) WHERE ClassID = ? AND SectionID = ? ORDER BY DayOfWeek, Period", [sourceClassId, sourceSectionId]);
      if (!source.length) throw notFound("The source section has no timetable entries to copy.");
      const destination = await tx.query("SELECT TOP 1 TimetableEntryID FROM TimetableEntries WITH (UPDLOCK, HOLDLOCK) WHERE ClassID = ? AND SectionID = ?", [targetClassId, targetSectionId]);
      if (destination.length) throw conflict("The destination section already has timetable entries. Nothing was overwritten.");
      let count = 0;
      for (const row of source) {
        const entry = {
          classId: targetClassId,
          sectionId: targetSectionId,
          teacherUserId: Number(teacherMapping[String(row.TeacherUserID)] || row.TeacherUserID),
          subjectId: Number(row.SubjectID),
          dayOfWeek: Number(row.DayOfWeek),
          period: Number(row.Period),
          startTime: String(row.StartTime).slice(0, 8),
          endTime: String(row.EndTime).slice(0, 8),
        };
        await validateReferences(tx, entry);
        await validateConflicts(tx, entry);
        await insertEntry(tx, entry);
        count += 1;
      }
      return count;
    });
    res.status(201).json({ message: `Copied ${copied} timetable entries.`, copied });
  } catch (e) { fail(res, e); }
};

const getTeacherTimetable = async (req, res) => {
  try {
    const db = await getConnection();
    res.json(await db.query(`${ENTRY_SELECT} WHERE te.TeacherUserID = ? ORDER BY te.DayOfWeek, te.Period`, [req.user.userId]));
  } catch (e) { fail(res, e); }
};

const getTeacherRoster = async (req, res) => {
  const id = Number(req.params.id);
  const date = req.query.date || todayString();
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid timetable entry ID." });
  if (!isValidDate(date)) return res.status(400).json({ message: "Date must use YYYY-MM-DD format." });
  if (date > todayString()) return res.status(400).json({ message: "Attendance cannot be marked for a future date." });
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayOfWeek = jsDay === 0 ? 7 : jsDay;
  try {
    const db = await getConnection();
    const entries = await db.query(`${ENTRY_SELECT} WHERE te.TimetableEntryID = ? AND te.TeacherUserID = ?`, [id, req.user.userId]);
    if (!entries.length) return res.status(404).json({ message: "This timetable entry is not assigned to you." });
    const entry = entries[0];
    if (Number(entry.DayOfWeek) !== dayOfWeek) return res.status(400).json({ message: "The selected date does not match this timetable day." });
    const students = await db.query(
      `SELECT st.StudentID, st.RollNumber, st.Name, st.ParentName, st.ParentPhone,
              at.AttendanceID, at.Status,
              CONVERT(VARCHAR(5), at.LectureStartTime, 108) AS LectureStartTime,
              CONVERT(VARCHAR(19), at.AttendanceTakenAt, 120) AS AttendanceTakenAt
       FROM Students st
       LEFT JOIN Attendance at ON at.StudentID = st.StudentID
         AND CONVERT(date, at.[Date]) = ?
         AND (at.TimetableEntryID = ? OR
              (at.ClassID = ? AND at.SectionID = ? AND at.SubjectID = ? AND at.Period = ? AND at.TeacherUserID = ?))
       WHERE st.IsActive = 1 AND st.ClassID = ? AND st.SectionID = ?
       ORDER BY TRY_CAST(st.RollNumber AS INT), st.RollNumber`,
      [date, id, entry.ClassID, entry.SectionID, entry.SubjectID, entry.Period, entry.TeacherUserID, entry.ClassID, entry.SectionID]
    );
    res.json({ assignment: { ...entry, AssignmentID: null, TimetableEntryID: entry.TimetableEntryID }, date, students });
  } catch (e) { fail(res, e); }
};

module.exports = { getAdminTimetable, saveAdminEntry, deleteAdminEntry, copyAdminTimetable, getTeacherTimetable, getTeacherRoster };