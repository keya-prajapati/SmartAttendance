/* Additive, idempotent schema migration. Runs at server start.
   NEVER drops/truncates/deletes anything. Existing Users / Students / Attendance rows are untouched. */
const { getConnection } = require("./db");

const DEFAULT_SECTIONS = ["A", "B", "C"];
const DEFAULT_SUBJECTS = ["Mathematics", "Science", "English", "Hindi", "Social Science", "Computer Science"];

async function run(db, label, sql, params) {
  try {
    await db.query(sql, params);
    return true;
  } catch (e) {
    console.error(`[schema] ${label} failed: ${e.message}`);
    return false;
  }
}

async function addColumn(db, table, column, ddl) {
  const r = await db.query(`SELECT COL_LENGTH('dbo.${table}', '${column}') AS L`);
  if (r[0].L === null) await run(db, `${table}.${column}`, `ALTER TABLE dbo.${table} ADD ${column} ${ddl}`);
}

/* "10", "Class 10", "class-10", 10  ->  10  (1..12) or null */
function parseClassNumber(v) {
  const m = String(v ?? "").match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1 && n <= 12 ? n : null;
}

async function ensureSection(db, classId, name) {
  const s = String(name || "").trim().toUpperCase();
  if (!s) return null;
  const r = await db.query("SELECT SectionID FROM Sections WHERE ClassID = ? AND SectionName = ?", [classId, s]);
  if (r.length) return Number(r[0].SectionID);
  const ins = await db.query("INSERT INTO Sections (ClassID, SectionName) OUTPUT INSERTED.SectionID AS id VALUES (?, ?)", [classId, s]);
  return Number(ins[0].id);
}

async function migrateTimetable(db) {
  await db.withTransaction(async (tx) => {
    await tx.query(`IF NOT EXISTS (
      SELECT 1 FROM sys.indexes WHERE name='UX_Sections_Class_Section' AND object_id=OBJECT_ID('dbo.Sections'))
      CREATE UNIQUE INDEX UX_Sections_Class_Section ON dbo.Sections (ClassID, SectionID)`);
    await tx.query(`IF OBJECT_ID('dbo.TimetableEntries','U') IS NULL
      CREATE TABLE dbo.TimetableEntries (
        TimetableEntryID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TimetableEntries PRIMARY KEY,
        DayOfWeek TINYINT NOT NULL,
        ClassID INT NOT NULL,
        SectionID INT NOT NULL,
        TeacherUserID INT NOT NULL,
        SubjectID INT NOT NULL,
        Period INT NOT NULL,
        StartTime TIME(0) NOT NULL,
        EndTime TIME(0) NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_TimetableEntries_CreatedAt DEFAULT SYSDATETIME(),
        CONSTRAINT CK_TimetableEntries_Day CHECK (DayOfWeek BETWEEN 1 AND 6),
        CONSTRAINT CK_TimetableEntries_Period CHECK (Period BETWEEN 1 AND 12),
        CONSTRAINT CK_TimetableEntries_Time CHECK (StartTime < EndTime),
        CONSTRAINT FK_TimetableEntries_Class FOREIGN KEY (ClassID) REFERENCES dbo.Classes(ClassID),
        CONSTRAINT FK_TimetableEntries_ClassSection FOREIGN KEY (ClassID, SectionID) REFERENCES dbo.Sections(ClassID, SectionID),
        CONSTRAINT FK_TimetableEntries_Teacher FOREIGN KEY (TeacherUserID) REFERENCES dbo.Users(UserId),
        CONSTRAINT FK_TimetableEntries_Subject FOREIGN KEY (SubjectID) REFERENCES dbo.Subjects(SubjectID),
        CONSTRAINT UQ_Timetable_ClassSectionDayPeriod UNIQUE (ClassID, SectionID, DayOfWeek, Period),
        CONSTRAINT UQ_Timetable_TeacherDayPeriod UNIQUE (TeacherUserID, DayOfWeek, Period)
      )`);
    await tx.query(`IF NOT EXISTS (
      SELECT 1 FROM sys.indexes WHERE name='IX_TimetableEntries_TeacherDayTime' AND object_id=OBJECT_ID('dbo.TimetableEntries'))
      CREATE INDEX IX_TimetableEntries_TeacherDayTime ON dbo.TimetableEntries (TeacherUserID, DayOfWeek, StartTime, EndTime)`);
    await tx.query(`IF NOT EXISTS (
      SELECT 1 FROM sys.indexes WHERE name='IX_TimetableEntries_ClassSectionDayTime' AND object_id=OBJECT_ID('dbo.TimetableEntries'))
      CREATE INDEX IX_TimetableEntries_ClassSectionDayTime ON dbo.TimetableEntries (ClassID, SectionID, DayOfWeek, StartTime, EndTime)`);
    const column = await tx.query("SELECT COL_LENGTH('dbo.Attendance','TimetableEntryID') AS ColumnLength");
    if (column[0].ColumnLength === null) await tx.query("ALTER TABLE dbo.Attendance ADD TimetableEntryID INT NULL");
    await tx.query(`IF NOT EXISTS (
      SELECT 1 FROM sys.foreign_keys WHERE name='FK_Attendance_TimetableEntry' AND parent_object_id=OBJECT_ID('dbo.Attendance'))
      ALTER TABLE dbo.Attendance ADD CONSTRAINT FK_Attendance_TimetableEntry
      FOREIGN KEY (TimetableEntryID) REFERENCES dbo.TimetableEntries(TimetableEntryID)`);
    await tx.query(`IF EXISTS (
      SELECT 1 FROM sys.key_constraints WHERE name='UQ_Student_Date' AND parent_object_id=OBJECT_ID('dbo.Attendance'))
      ALTER TABLE dbo.Attendance DROP CONSTRAINT UQ_Student_Date`);
    await tx.query(`IF NOT EXISTS (
      SELECT 1 FROM sys.indexes WHERE name='UX_Attendance_Legacy_Student_Date' AND object_id=OBJECT_ID('dbo.Attendance'))
      CREATE UNIQUE INDEX UX_Attendance_Legacy_Student_Date ON dbo.Attendance (StudentID, [Date]) WHERE Period IS NULL`);
  });
}

async function migrateAnnouncements(db) {
  await db.withTransaction(async (tx) => {
    await tx.query(`IF OBJECT_ID('dbo.Announcements','U') IS NULL
      CREATE TABLE dbo.Announcements (
        AnnouncementID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Announcements PRIMARY KEY,
        Title NVARCHAR(160) NOT NULL,
        Message NVARCHAR(MAX) NOT NULL,
        AnnouncementType NVARCHAR(20) NOT NULL,
        TargetAudience NVARCHAR(20) NOT NULL,
        PublishDate DATE NOT NULL,
        ExpiryDate DATE NULL,
        IsPublished BIT NOT NULL CONSTRAINT DF_Announcements_IsPublished DEFAULT (0),
        IsArchived BIT NOT NULL CONSTRAINT DF_Announcements_IsArchived DEFAULT (0),
        CreatedByUserID INT NOT NULL,
        CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Announcements_CreatedAt DEFAULT SYSDATETIME(),
        UpdatedAt DATETIME2(0) NULL,
        CONSTRAINT CK_Announcements_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0),
        CONSTRAINT CK_Announcements_Message CHECK (LEN(LTRIM(RTRIM(Message))) > 0),
        CONSTRAINT CK_Announcements_Type CHECK (AnnouncementType IN ('General','Exam','Holiday','Event','Important','Other')),
        CONSTRAINT CK_Announcements_Audience CHECK (TargetAudience IN ('Everyone','Teachers','Students')),
        CONSTRAINT CK_Announcements_Expiry CHECK (ExpiryDate IS NULL OR ExpiryDate >= PublishDate),
        CONSTRAINT FK_Announcements_CreatedBy FOREIGN KEY (CreatedByUserID) REFERENCES dbo.Users(UserId)
      )`);
    await tx.query(`IF NOT EXISTS (
      SELECT 1 FROM sys.indexes WHERE name='IX_Announcements_AudienceWindow' AND object_id=OBJECT_ID('dbo.Announcements'))
      CREATE INDEX IX_Announcements_AudienceWindow ON dbo.Announcements (IsArchived, IsPublished, TargetAudience, PublishDate, ExpiryDate)`);
    await tx.query(`IF NOT EXISTS (
      SELECT 1 FROM sys.indexes WHERE name='IX_Announcements_AdminList' AND object_id=OBJECT_ID('dbo.Announcements'))
      CREATE INDEX IX_Announcements_AdminList ON dbo.Announcements (CreatedAt DESC, AnnouncementID DESC)`);
  });
}

async function migrate() {
  const db = await getConnection();

  // ---- master tables (created only if they do not exist) ----
  await run(db, "Classes", `IF OBJECT_ID('dbo.Classes','U') IS NULL
    CREATE TABLE dbo.Classes (
      ClassID INT IDENTITY(1,1) PRIMARY KEY,
      ClassNumber INT NOT NULL UNIQUE,
      ClassName NVARCHAR(30) NOT NULL)`);
  await run(db, "Sections", `IF OBJECT_ID('dbo.Sections','U') IS NULL
    CREATE TABLE dbo.Sections (
      SectionID INT IDENTITY(1,1) PRIMARY KEY,
      ClassID INT NOT NULL REFERENCES dbo.Classes(ClassID),
      SectionName NVARCHAR(10) NOT NULL,
      CONSTRAINT UQ_Sections UNIQUE (ClassID, SectionName))`);
  await run(db, "Subjects", `IF OBJECT_ID('dbo.Subjects','U') IS NULL
    CREATE TABLE dbo.Subjects (
      SubjectID INT IDENTITY(1,1) PRIMARY KEY,
      SubjectName NVARCHAR(100) NOT NULL UNIQUE)`);

  // teacher = a Users row with Role='Teacher' (no duplicate Teachers table)
  const fkUsers = "REFERENCES dbo.Users(UserId)";
  const ta = `IF OBJECT_ID('dbo.TeacherAssignments','U') IS NULL
    CREATE TABLE dbo.TeacherAssignments (
      AssignmentID INT IDENTITY(1,1) PRIMARY KEY,
      TeacherUserID INT NOT NULL __FK__,
      ClassID INT NOT NULL REFERENCES dbo.Classes(ClassID),
      SectionID INT NOT NULL REFERENCES dbo.Sections(SectionID),
      SubjectID INT NOT NULL REFERENCES dbo.Subjects(SubjectID),
      Period INT NOT NULL,
      StartTime TIME(0) NOT NULL,
      EndTime TIME(0) NOT NULL,
      CreatedAt DATETIME2(0) NOT NULL DEFAULT SYSDATETIME(),
      CONSTRAINT UQ_TA_Teacher_Period UNIQUE (TeacherUserID, Period),
      CONSTRAINT UQ_TA_Section_Period UNIQUE (ClassID, SectionID, Period))`;
  if (!(await run(db, "TeacherAssignments(FK)", ta.replace("__FK__", fkUsers)))) {
    await run(db, "TeacherAssignments(no FK)", ta.replace("__FK__", ""));
  }

  // ---- seed (only missing rows) ----
  for (let n = 1; n <= 12; n++) {
    await run(db, `seed class ${n}`, `IF NOT EXISTS (SELECT 1 FROM Classes WHERE ClassNumber = ?) INSERT INTO Classes (ClassNumber, ClassName) VALUES (?, ?)`, [n, n, `Class ${n}`]);
  }
  const classes = await db.query("SELECT ClassID FROM Classes");
  const anySection = await db.query("SELECT TOP 1 SectionID FROM Sections");
  if (!anySection.length) {
    for (const c of classes) for (const s of DEFAULT_SECTIONS) await ensureSection(db, Number(c.ClassID), s);
  }
  for (const s of DEFAULT_SUBJECTS) {
    await run(db, `seed subject ${s}`, "IF NOT EXISTS (SELECT 1 FROM Subjects WHERE SubjectName = ?) INSERT INTO Subjects (SubjectName) VALUES (?)", [s, s]);
  }

  // ---- extend existing tables (add nullable columns only) ----
  await addColumn(db, "Users", "StudentID", "INT NULL");
  await addColumn(db, "Students", "ClassID", "INT NULL");
  await addColumn(db, "Students", "SectionID", "INT NULL");
  await addColumn(db, "Students", "IsActive", "BIT NOT NULL CONSTRAINT DF_Students_IsActive DEFAULT (1)");
  for (const [c, d] of [
    ["ClassID", "INT NULL"], ["SectionID", "INT NULL"], ["SubjectID", "INT NULL"],
    ["TeacherUserID", "INT NULL"], ["AssignmentID", "INT NULL"], ["Period", "INT NULL"],
    ["LectureStartTime", "TIME(0) NULL"], ["LectureEndTime", "TIME(0) NULL"],
    ["AttendanceTakenAt", "DATETIME2(0) NULL"], ["CreatedAt", "DATETIME2(0) NULL CONSTRAINT DF_Attendance_CreatedAt DEFAULT SYSDATETIME()"],
    ["UpdatedAt", "DATETIME2(0) NULL"], ["Source", "NVARCHAR(20) NULL"],
  ]) await addColumn(db, "Attendance", c, d);

  // foreign keys (best effort; skipped silently if already present / incompatible)
  const fks = [
    ["Students", "FK_Students_Class", "ClassID", "Classes(ClassID)"],
    ["Students", "FK_Students_Section", "SectionID", "Sections(SectionID)"],
    ["Attendance", "FK_Att_Class", "ClassID", "Classes(ClassID)"],
    ["Attendance", "FK_Att_Section", "SectionID", "Sections(SectionID)"],
    ["Attendance", "FK_Att_Subject", "SubjectID", "Subjects(SubjectID)"],
    ["Attendance", "FK_Att_Teacher", "TeacherUserID", "Users(UserId)"],
    ["Attendance", "FK_Att_Assignment", "AssignmentID", "TeacherAssignments(AssignmentID)"],
  ];
  for (const [t, name, col, ref] of fks) {
    await run(db, name, `IF OBJECT_ID('${name}','F') IS NULL ALTER TABLE dbo.${t} ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES dbo.${ref}`);
  }

  await migrateTimetable(db);
  await migrateAnnouncements(db);

  // duplicate protection for lecture attendance (legacy rows have Period NULL and are excluded)
  await run(db, "UX_Attendance_Lecture", `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_Attendance_Lecture' AND object_id=OBJECT_ID('dbo.Attendance'))
    CREATE UNIQUE INDEX UX_Attendance_Lecture ON dbo.Attendance (StudentID, [Date], ClassID, SectionID, SubjectID, Period) WHERE Period IS NOT NULL`);

  // ---- backfill Students.ClassID / SectionID from the existing text columns ----
  const orphans = await db.query("SELECT StudentID, Class, Section FROM Students WHERE ClassID IS NULL");
  let linked = 0;
  for (const s of orphans) {
    const n = parseClassNumber(s.Class);
    if (!n) continue;
    const c = await db.query("SELECT ClassID FROM Classes WHERE ClassNumber = ?", [n]);
    if (!c.length) continue;
    const classId = Number(c[0].ClassID);
    const secName = String(s.Section || "").trim();
    const sectionId = secName ? await ensureSection(db, classId, secName) : null;
    await db.query("UPDATE Students SET ClassID = ?, SectionID = ? WHERE StudentID = ?", [classId, sectionId, s.StudentID]);
    linked++;
  }
  // self-check: run the exact shapes the API uses and print the real error if any table/column is wrong
  for (const [label, q] of [
    ["Classes", "SELECT TOP 1 ClassID, ClassNumber, ClassName FROM Classes"],
    ["Sections", "SELECT TOP 1 SectionID, ClassID, SectionName FROM Sections"],
    ["Subjects", "SELECT TOP 1 SubjectID, SubjectName FROM Subjects"],
    ["TeacherAssignments", "SELECT TOP 1 AssignmentID, TeacherUserID, ClassID, SectionID, SubjectID, Period, StartTime, EndTime FROM TeacherAssignments"],
    ["Students", "SELECT TOP 1 StudentID, RollNumber, Name, ClassID, SectionID FROM Students"],
    ["Attendance", "SELECT TOP 1 AttendanceID, StudentID, [Date], Status, ClassID, SectionID, SubjectID, TeacherUserID, AssignmentID, Period, LectureStartTime, LectureEndTime, AttendanceTakenAt, CreatedAt FROM Attendance"],
  ]) {
    try { await db.query(q); } catch (e) { console.error(`[schema] SELF-CHECK FAILED for ${label}: ${e.message}`); }
  }
  console.log(`[schema] migration OK. Students linked to Class/Section: ${linked}/${orphans.length}`);
}

module.exports = { migrate, parseClassNumber, ensureSection };
