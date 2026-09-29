const { getConnection } = require("../config/db");
const { ensureSection } = require("../config/schema");
const { parseTime } = require("../config/importParser");

const fail = (res, err) => {
  console.error("[API ERROR]", err.message);

  res.status(500).json({
    message: `Database error: ${err.message}`,
    error: err.message
  });
};

const T = (col) => `CONVERT(VARCHAR(5), ${col}, 108)`;


/* ---------------- classes / sections / subjects ---------------- */

const getClasses = async (req, res) => {
  try {
    const db = await getConnection();

    res.json(
      await db.query(
        "SELECT ClassID, ClassNumber, ClassName FROM Classes ORDER BY ClassNumber"
      )
    );
  } catch (e) {
    fail(res, e);
  }
};


const updateClass = async (req, res) => {
  const name = String(req.body.className || "").trim();

  if (!name) {
    return res.status(400).json({
      message: "Class name is required."
    });
  }

  try {
    const db = await getConnection();

    await db.query(
      "UPDATE Classes SET ClassName = ? WHERE ClassID = ?",
      [name, req.params.id]
    );

    res.json({
      message: "Class updated."
    });
  } catch (e) {
    fail(res, e);
  }
};


const getSections = async (req, res) => {
  try {
    const db = await getConnection();
    const { classId } = req.query;

    const rows = await db.query(
      `
      SELECT
        s.SectionID,
        s.ClassID,
        c.ClassNumber,
        c.ClassName,
        s.SectionName,
        (
          SELECT COUNT(*)
          FROM Students st
          WHERE st.SectionID = s.SectionID
        ) AS StudentCount
      FROM Sections s
      JOIN Classes c ON c.ClassID = s.ClassID
      ${classId ? "WHERE s.ClassID = ?" : ""}
      ORDER BY c.ClassNumber, s.SectionName
      `,
      classId ? [classId] : []
    );

    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
};


const addSection = async (req, res) => {
  const { classId, sectionName } = req.body;

  if (!classId || !String(sectionName || "").trim()) {
    return res.status(400).json({
      message: "Class and section name are required."
    });
  }

  try {
    const db = await getConnection();

    const name = String(sectionName).trim().toUpperCase();

    const ex = await db.query(
      "SELECT 1 AS x FROM Sections WHERE ClassID = ? AND SectionName = ?",
      [classId, name]
    );

    if (ex.length) {
      return res.status(409).json({
        message: `Section ${name} already exists for this class.`
      });
    }

    await ensureSection(db, Number(classId), name);

    res.status(201).json({
      message: `Section ${name} added.`
    });
  } catch (e) {
    fail(res, e);
  }
};


const deleteSection = async (req, res) => {
  try {
    const db = await getConnection();

    const s = await db.query(
      "SELECT COUNT(*) AS n FROM Students WHERE SectionID = ?",
      [req.params.id]
    );

    const a = await db.query(
      "SELECT COUNT(*) AS n FROM TeacherAssignments WHERE SectionID = ?",
      [req.params.id]
    );

    if (Number(s[0].n) || Number(a[0].n)) {
      return res.status(409).json({
        message:
          "This section still has students or teacher assignments and cannot be deleted."
      });
    }

    await db.query(
      "DELETE FROM Sections WHERE SectionID = ?",
      [req.params.id]
    );

    res.json({
      message: "Section deleted."
    });
  } catch (e) {
    fail(res, e);
  }
};


const getSubjects = async (req, res) => {
  try {
    const db = await getConnection();

    res.json(
      await db.query(
        "SELECT SubjectID, SubjectName FROM Subjects ORDER BY SubjectName"
      )
    );
  } catch (e) {
    fail(res, e);
  }
};


const addSubject = async (req, res) => {
  const name = String(req.body.subjectName || "").trim();

  if (!name) {
    return res.status(400).json({
      message: "Subject name is required."
    });
  }

  try {
    const db = await getConnection();

    const ex = await db.query(
      "SELECT 1 AS x FROM Subjects WHERE SubjectName = ?",
      [name]
    );

    if (ex.length) {
      return res.status(409).json({
        message: "Subject already exists."
      });
    }

    await db.query(
      "INSERT INTO Subjects (SubjectName) VALUES (?)",
      [name]
    );

    res.status(201).json({
      message: "Subject added."
    });
  } catch (e) {
    fail(res, e);
  }
};


const updateSubject = async (req, res) => {
  const name = String(req.body.subjectName || "").trim();

  if (!name) {
    return res.status(400).json({
      message: "Subject name is required."
    });
  }

  try {
    const db = await getConnection();

    const ex = await db.query(
      "SELECT 1 AS x FROM Subjects WHERE SubjectName = ? AND SubjectID <> ?",
      [name, req.params.id]
    );

    if (ex.length) {
      return res.status(409).json({
        message: "Another subject already has this name."
      });
    }

    await db.query(
      "UPDATE Subjects SET SubjectName = ? WHERE SubjectID = ?",
      [name, req.params.id]
    );

    res.json({
      message: "Subject updated."
    });
  } catch (e) {
    fail(res, e);
  }
};


const deleteSubject = async (req, res) => {
  try {
    const db = await getConnection();

    const a = await db.query(
      "SELECT COUNT(*) AS n FROM TeacherAssignments WHERE SubjectID = ?",
      [req.params.id]
    );

    if (Number(a[0].n)) {
      return res.status(409).json({
        message:
          "This subject is used in teacher assignments and cannot be deleted."
      });
    }

    await db.query(
      "DELETE FROM Subjects WHERE SubjectID = ?",
      [req.params.id]
    );

    res.json({
      message: "Subject deleted."
    });
  } catch (e) {
    fail(res, e);
  }
};


const getTeachers = async (req, res) => {
  try {
    const db = await getConnection();

    res.json(
      await db.query(
        "SELECT UserId, FullName, Username, Phone FROM Users WHERE Role = 'Teacher' ORDER BY FullName"
      )
    );
  } catch (e) {
    fail(res, e);
  }
};


/* ---------------- teacher assignments ---------------- */

const ASSIGN_SELECT = `
  SELECT
    ta.AssignmentID,
    ta.TeacherUserID,
    u.FullName AS TeacherName,

    ta.ClassID,
    c.ClassNumber,
    c.ClassName,

    ta.SectionID,
    s.SectionName,

    ta.SubjectID,
    sub.SubjectName,

    ta.Period,

    ${T("ta.StartTime")} AS StartTime,
    ${T("ta.EndTime")} AS EndTime,

    (
      SELECT COUNT(*)
      FROM Students st
      WHERE st.ClassID = ta.ClassID
        AND st.SectionID = ta.SectionID
    ) AS StudentCount

  FROM TeacherAssignments ta

  JOIN Users u
    ON u.UserId = ta.TeacherUserID

  JOIN Classes c
    ON c.ClassID = ta.ClassID

  JOIN Sections s
    ON s.SectionID = ta.SectionID

  JOIN Subjects sub
    ON sub.SubjectID = ta.SubjectID
`;


const getAssignments = async (req, res) => {
  try {
    const db = await getConnection();

    const w = [];
    const p = [];

    if (req.query.teacherId) {
      w.push("ta.TeacherUserID = ?");
      p.push(req.query.teacherId);
    }

    if (req.query.classId) {
      w.push("ta.ClassID = ?");
      p.push(req.query.classId);
    }

    res.json(
      await db.query(
        `
        ${ASSIGN_SELECT}
        ${w.length ? "WHERE " + w.join(" AND ") : ""}
        ORDER BY c.ClassNumber, s.SectionName, ta.Period
        `,
        p
      )
    );
  } catch (e) {
    fail(res, e);
  }
};


/* ---------------- validate teacher assignment ---------------- */

async function validateAssignment(db, b, ignoreId) {
  const {
    teacherUserId,
    classId,
    sectionId,
    subjectId
  } = b;

  const period = Number(b.period);

  const start = parseTime(b.startTime);
  const end = parseTime(b.endTime);

  if (!teacherUserId || !classId || !sectionId || !subjectId) {
    return "Teacher, class, section and subject are required.";
  }

  if (!Number.isInteger(period) || period < 1 || period > 12) {
    return "Period must be a whole number between 1 and 12.";
  }

  if (!start || !end) {
    return "Enter valid start and end times.";
  }

  if (end <= start) {
    return "End time must be after start time.";
  }

  const t = await db.query(
    "SELECT 1 AS x FROM Users WHERE UserId = ? AND Role = 'Teacher'",
    [teacherUserId]
  );

  if (!t.length) {
    return "Selected user is not a teacher.";
  }

  const sec = await db.query(
    "SELECT 1 AS x FROM Sections WHERE SectionID = ? AND ClassID = ?",
    [sectionId, classId]
  );

  if (!sec.length) {
    return "Section does not belong to the selected class.";
  }

  const ig = ignoreId || 0;

  const c1 = await db.query(
    `
    SELECT AssignmentID
    FROM TeacherAssignments
    WHERE TeacherUserID = ?
      AND Period = ?
      AND AssignmentID <> ?
    `,
    [teacherUserId, period, ig]
  );

  if (c1.length) {
    return `This teacher already has another class in Period ${period}.`;
  }

  const c2 = await db.query(
    `
    SELECT AssignmentID
    FROM TeacherAssignments
    WHERE ClassID = ?
      AND SectionID = ?
      AND Period = ?
      AND AssignmentID <> ?
    `,
    [classId, sectionId, period, ig]
  );

  if (c2.length) {
    return `This class/section already has a lecture assigned in Period ${period}.`;
  }

  return {
    period,
    start,
    end
  };
}


/* ---------------- add assignment ---------------- */

const addAssignment = async (req, res) => {
  try {
    const db = await getConnection();

    const v = await validateAssignment(db, req.body);

    if (typeof v === "string") {
      return res.status(400).json({
        message: v
      });
    }

    const teacherUserId = Number(req.body.teacherUserId);
    const classId = Number(req.body.classId);
    const sectionId = Number(req.body.sectionId);
    const subjectId = Number(req.body.subjectId);
    const period = Number(v.period);

    if (
      !Number.isInteger(teacherUserId) ||
      !Number.isInteger(classId) ||
      !Number.isInteger(sectionId) ||
      !Number.isInteger(subjectId) ||
      !Number.isInteger(period)
    ) {
      return res.status(400).json({
        message: "Invalid teacher, class, section, subject or period."
      });
    }

    const startTime = `${v.start}:00`;
    const endTime = `${v.end}:00`;

    const sql = `
      INSERT INTO TeacherAssignments
      (
        TeacherUserID,
        ClassID,
        SectionID,
        SubjectID,
        Period,
        StartTime,
        EndTime
      )
      VALUES
      (
        ${teacherUserId},
        ${classId},
        ${sectionId},
        ${subjectId},
        ${period},
        '${startTime}',
        '${endTime}'
      )
    `;

    await db.query(sql);

    res.status(201).json({
      message: "Teacher assigned successfully."
    });

  } catch (e) {
    fail(res, e);
  }
};


/* ---------------- update assignment ---------------- */

const updateAssignment = async (req, res) => {
  try {
    const db = await getConnection();

    const assignmentId = Number(req.params.id);

    if (!Number.isInteger(assignmentId)) {
      return res.status(400).json({
        message: "Invalid assignment ID."
      });
    }

    const v = await validateAssignment(
      db,
      req.body,
      assignmentId
    );

    if (typeof v === "string") {
      return res.status(400).json({
        message: v
      });
    }

    const teacherUserId = Number(req.body.teacherUserId);
    const classId = Number(req.body.classId);
    const sectionId = Number(req.body.sectionId);
    const subjectId = Number(req.body.subjectId);
    const period = Number(v.period);

    if (
      !Number.isInteger(teacherUserId) ||
      !Number.isInteger(classId) ||
      !Number.isInteger(sectionId) ||
      !Number.isInteger(subjectId) ||
      !Number.isInteger(period)
    ) {
      return res.status(400).json({
        message: "Invalid teacher, class, section, subject or period."
      });
    }

    const startTime = `${v.start}:00`;
    const endTime = `${v.end}:00`;

    const sql = `
      UPDATE TeacherAssignments
      SET
        TeacherUserID = ${teacherUserId},
        ClassID = ${classId},
        SectionID = ${sectionId},
        SubjectID = ${subjectId},
        Period = ${period},
        StartTime = '${startTime}',
        EndTime = '${endTime}'
      WHERE AssignmentID = ${assignmentId}
    `;

    await db.query(sql);

    res.json({
      message: "Assignment updated."
    });

  } catch (e) {
    fail(res, e);
  }
};

/* ---------------- delete assignment ---------------- */

const deleteAssignment = async (req, res) => {
  try {
    const db = await getConnection();

    const a = await db.query(
      "SELECT COUNT(*) AS n FROM Attendance WHERE AssignmentID = ?",
      [req.params.id]
    );

    if (Number(a[0].n)) {
      return res.status(409).json({
        message:
          `This assignment has ${a[0].n} attendance record(s) and cannot be deleted. Attendance history is preserved.`
      });
    }

    await db.query(
      "DELETE FROM TeacherAssignments WHERE AssignmentID = ?",
      [req.params.id]
    );

    res.json({
      message: "Assignment deleted."
    });

  } catch (e) {
    fail(res, e);
  }
};


/* ---------------- teacher: My Classes ---------------- */

const myClasses = async (req, res) => {
  try {
    const db = await getConnection();

    const today = new Date().toLocaleDateString("en-CA");

    const rows = await db.query(
      `
      ${ASSIGN_SELECT.replace(
        "FROM TeacherAssignments ta",
        `,
        (
          SELECT COUNT(DISTINCT a.StudentID)
          FROM Attendance a
          WHERE a.AssignmentID = ta.AssignmentID
            AND CONVERT(date, a.[Date]) = ?
        ) AS MarkedToday

        FROM TeacherAssignments ta`
      )}

      WHERE ta.TeacherUserID = ?
      ORDER BY ta.Period
      `,
      [
        today,
        req.user.userId
      ]
    );

    res.json(rows);

  } catch (e) {
    fail(res, e);
  }
};


/* ---------------- lecture roster ---------------- */

const lectureRoster = async (req, res) => {
  try {
    const db = await getConnection();

    const a = await db.query(
      `${ASSIGN_SELECT} WHERE ta.AssignmentID = ?`,
      [req.params.assignmentId]
    );

    if (!a.length) {
      return res.status(404).json({
        message: "Assignment not found."
      });
    }

    const isAdmin =
      String(req.user.role).toLowerCase() === "admin";

    if (
      !isAdmin &&
      Number(a[0].TeacherUserID) !== Number(req.user.userId)
    ) {
      return res.status(403).json({
        message: "This class is not assigned to you."
      });
    }

    const date =
      req.query.date ||
      new Date().toLocaleDateString("en-CA");

    const students = await db.query(
      `
      SELECT
        st.StudentID,
        st.RollNumber,
        st.Name,
        st.ParentName,
        st.ParentPhone,

        at.AttendanceID,
        at.Status,

        ${T("at.LectureStartTime")} AS LectureStartTime,

        CONVERT(
          VARCHAR(19),
          at.AttendanceTakenAt,
          120
        ) AS AttendanceTakenAt

      FROM Students st

      LEFT JOIN Attendance at
        ON at.StudentID = st.StudentID
        AND at.AssignmentID = ?
        AND CONVERT(date, at.[Date]) = ?

      WHERE st.ClassID = ?
        AND st.SectionID = ?

      ORDER BY
        TRY_CAST(st.RollNumber AS INT),
        st.RollNumber
      `,
      [
        req.params.assignmentId,
        date,
        a[0].ClassID,
        a[0].SectionID
      ]
    );

    res.json({
      assignment: a[0],
      date,
      students
    });

  } catch (e) {
    fail(res, e);
  }
};


/* ---------------- exports ---------------- */

module.exports = {
  getClasses,
  updateClass,

  getSections,
  addSection,
  deleteSection,

  getSubjects,
  addSubject,
  updateSubject,
  deleteSubject,

  getTeachers,

  getAssignments,
  addAssignment,
  updateAssignment,
  deleteAssignment,

  myClasses,
  lectureRoster
};