const { getConnection } = require("../config/db");

const {
  getLinkedStudentId,
  isValidDate,
  todayString,
  normalizeStatus,
} = require("../config/helpers");

const {
  buildAbsentMessage,
  whatsappUrl,
  openWhatsApp,
  toIntlPhone,
} = require("../config/whatsappService");

const {
  parseFile,
  pickField,
  parseDate,
  parseTime,
  parseDateTime,
} = require("../config/importParser");

const { parseClassNumber } = require("../config/schema");

const fail = (res, err) => {
  console.error("[API ERROR]", err.message);
  res.status(500).json({
    message: `Database error: ${err.message}`,
    error: err.message,
  });
};

const roleOf = (req) => String(req.user.role).toLowerCase();

/*
  PostgreSQL pg returns:
  {
    rows: [...]
  }

  This helper keeps the controller code simple.
*/
const queryRows = async (db, sql, params = []) => {
  const result = await db.query(sql, params);
  return result.rows || [];
};

/*
  PostgreSQL time formatting.
  SQL Server:
    CONVERT(VARCHAR(5), column, 108)

  PostgreSQL:
    to_char(column, 'HH24:MI')
*/
const T = (col) => `to_char(${col}, 'HH24:MI')`;

/*
  PostgreSQL duplicate-key error:
  23505 = unique_violation
*/
const isDupError = (e) =>
  String(e?.code || "") === "23505" ||
  /duplicate key|unique constraint/i.test(String(e?.message || ""));


/*
  Full attendance row, joined with related tables.
  PostgreSQL table/column names are lowercase.
*/
const REPORT_SELECT = `
  SELECT
    a.attendanceid AS "AttendanceID",
    a.studentid AS "StudentID",
    st.rollnumber AS "RollNumber",
    st.name AS "Name",
    st.parentname AS "ParentName",
    st.parentphone AS "ParentPhone",

    COALESCE(
      c.classnumber,
      CASE
        WHEN st.class ~ '^[0-9]+$' THEN st.class::int
        ELSE NULL
      END
    ) AS "Class",

    COALESCE(sec.sectionname, st.section) AS "Section",

    sub.subjectname AS "Subject",

    a.teacheruserid AS "TeacherID",
    u.fullname AS "TeacherName",

    a.assignmentid AS "AssignmentID",
    a.period AS "Period",

    ${T("a.lecturestarttime")} AS "LectureStartTime",
    ${T("a.lectureendtime")} AS "LectureEndTime",

    to_char(a.date, 'YYYY-MM-DD') AS "Date",
    to_char(a.attendancetakenat, 'YYYY-MM-DD HH24:MI:SS') AS "AttendanceTakenAt",
    to_char(a.createdat, 'YYYY-MM-DD HH24:MI:SS') AS "CreatedAt",

    a.status AS "Status",
    a.source AS "Source"

  FROM attendance a

  JOIN students st
    ON st.studentid = a.studentid

  LEFT JOIN classes c
    ON c.classid = COALESCE(a.classid, st.classid)

  LEFT JOIN sections sec
    ON sec.sectionid = COALESCE(a.sectionid, st.sectionid)

  LEFT JOIN subjects sub
    ON sub.subjectid = a.subjectid

  LEFT JOIN users u
    ON u.userid = a.teacheruserid
`;


/*
  Builds WHERE from query filters + role scope.

  PostgreSQL uses:
    $1, $2, $3 ...

  instead of SQL Server / ODBC:
    ?, ?, ?
*/
function reportWhere(req) {
  const q = req.query;

  const w = [];
  const p = [];

  const add = (condition, value) => {
    p.push(value);
    w.push(condition.replace("?", `$${p.length}`));
  };

  if (q.date) {
    add("a.date::date = ?", q.date);
  }

  if (q.from) {
    add("a.date::date >= ?", q.from);
  }

  if (q.to) {
    add("a.date::date <= ?", q.to);
  }

  if (q.classId) {
    add("COALESCE(a.classid, st.classid) = ?", q.classId);
  }

  if (q.class) {
    add("c.classnumber = ?", parseClassNumber(q.class) || 0);
  }

  if (q.sectionId) {
    add("COALESCE(a.sectionid, st.sectionid) = ?", q.sectionId);
  }

  if (q.section) {
    add(
      "UPPER(sec.sectionname) = ?",
      String(q.section).toUpperCase()
    );
  }

  if (q.subjectId) {
    add("a.subjectid = ?", q.subjectId);
  }

  if (q.teacherId) {
    add("a.teacheruserid = ?", q.teacherId);
  }

  if (q.period) {
    add("a.period = ?", q.period);
  }

  if (q.studentId) {
    add("a.studentid = ?", q.studentId);
  }

  if (q.q) {
    const searchValue = `%${q.q}%`;

    p.push(searchValue);
    const p1 = `$${p.length}`;

    p.push(searchValue);
    const p2 = `$${p.length}`;

    w.push(
      `(st.name ILIKE ${p1} OR st.rollnumber ILIKE ${p2})`
    );
  }

  const st = normalizeStatus(q.status);

  if (st) {
    add("a.status = ?", st);
  }

  const role = roleOf(req);

  if (role === "teacher") {
    const p1 = `$${p.length + 1}`;
    const p2 = `$${p.length + 2}`;

    w.push(`
      (
        a.teacheruserid = ${p1}
        OR EXISTS (
          SELECT 1
          FROM teacherassignments ta
          WHERE ta.teacheruserid = ${p2}
            AND ta.classid = COALESCE(a.classid, st.classid)
            AND ta.sectionid = COALESCE(a.sectionid, st.sectionid)
        )
      )
    `);

    p.push(req.user.userId);
    p.push(req.user.userId);
  }

  return {
    where: w.length ? "WHERE " + w.join(" AND ") : "",
    params: p,
  };
}


/*
  GET /attendance/report
*/
const getAttendanceReport = async (req, res) => {
  try {
    if (roleOf(req) === "student") {
      return res.status(403).json({
        message: "Use /attendance/my.",
      });
    }

    const db = await getConnection();

    const { where, params } = reportWhere(req);

    const rows = await queryRows(
      db,
      `${REPORT_SELECT}
       ${where}
       ORDER BY a.date DESC, a.period NULLS LAST, st.name`,
      params
    );

    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
};


/*
  GET attendance summary
*/
const getAttendanceSummary = async (req, res) => {
  try {
    if (roleOf(req) === "student") {
      return res.status(403).json({
        message: "Forbidden.",
      });
    }

    const db = await getConnection();

    const { where, params } = reportWhere(req);

    const rows = await queryRows(
      db,
      `
        SELECT
          COUNT(*) AS "Total",

          COALESCE(
            SUM(
              CASE
                WHEN a.status = 'Present' THEN 1
                ELSE 0
              END
            ),
            0
          ) AS "Present",

          COALESCE(
            SUM(
              CASE
                WHEN a.status = 'Absent' THEN 1
                ELSE 0
              END
            ),
            0
          ) AS "Absent"

        FROM attendance a

        JOIN students st
          ON st.studentid = a.studentid

        LEFT JOIN classes c
          ON c.classid = COALESCE(a.classid, st.classid)

        LEFT JOIN sections sec
          ON sec.sectionid = COALESCE(a.sectionid, st.sectionid)

        ${where}
      `,
      params
    );

    const total = Number(rows[0]?.Total) || 0;
    const present = Number(rows[0]?.Present) || 0;
    const absent = Number(rows[0]?.Absent) || 0;

    res.json({
      total,
      present,
      absent,
      percentage: total
        ? Math.round((present / total) * 1000) / 10
        : null,
    });
  } catch (e) {
    fail(res, e);
  }
};


/*
  Export attendance
*/
const EXPORT_HEAD = [
  "Date",
  "Roll Number",
  "Student Name",
  "Class",
  "Section",
  "Subject",
  "Teacher",
  "Period",
  "Lecture Start Time",
  "Lecture End Time",
  "Status",
  "Parent Name",
  "Parent Phone",
  "Attendance Taken At",
];

const safeName = (v) =>
  String(v || "").replace(/[^A-Za-z0-9-]/g, "");

const exportAttendance = async (req, res) => {
  try {
    if (roleOf(req) === "student") {
      return res.status(403).json({
        message: "Forbidden.",
      });
    }

    const db = await getConnection();

    const { where, params } = reportWhere(req);

    const rows = await queryRows(
      db,
      `${REPORT_SELECT}
       ${where}
       ORDER BY a.date DESC, a.period NULLS LAST, st.rollnumber`,
      params
    );

    const data = rows.map((r) =>
      [
        r.Date,
        r.RollNumber,
        r.Name,
        r.Class,
        r.Section,
        r.Subject,
        r.TeacherName,
        r.Period,
        r.LectureStartTime,
        r.LectureEndTime,
        r.Status,
        r.ParentName,
        r.ParentPhone,
        r.AttendanceTakenAt,
      ].map((v) =>
        v === null || v === undefined ? "" : v
      )
    );

    const f = rows[0] || {};

    const same = (k) =>
      rows.length && rows.every((r) => r[k] === f[k]);

    const dateTag =
      req.query.date ||
      (
        req.query.from || req.query.to
          ? `${req.query.from || "start"}_to_${req.query.to || "now"}`
          : same("Date")
            ? f.Date
            : "All"
      );

    const base = [
      "Attendance",
      same("Class") && f.Class
        ? `Class${f.Class}`
        : null,
      same("Section") && f.Section
        ? safeName(f.Section)
        : null,
      same("Subject") && f.Subject
        ? safeName(f.Subject)
        : null,
      dateTag,
    ]
      .filter(Boolean)
      .join("_");

    const fmt = String(
      req.query.format || "xlsx"
    ).toLowerCase();

    if (fmt === "csv") {
      const cell = (v) => {
        let t = String(v);

        if (/^[=+\-@]/.test(t)) {
          t = `'${t}`;
        }

        return /[",\n\r]/.test(t)
          ? `"${t.replace(/"/g, '""')}"`
          : t;
      };

      const text =
        "\uFEFF" +
        [EXPORT_HEAD, ...data]
          .map((r) => r.map(cell).join(","))
          .join("\r\n");

      res.set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          `attachment; filename="${base}.csv"`,
        "Access-Control-Expose-Headers":
          "Content-Disposition",
      });

      return res.send(text);
    }

    const XLSX = require("xlsx");

    const ws = XLSX.utils.aoa_to_sheet([
      EXPORT_HEAD,
      ...data,
    ]);

    ws["!cols"] = EXPORT_HEAD.map((h) => ({
      wch: Math.max(12, h.length + 2),
    }));

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      ws,
      "Attendance"
    );

    const buf = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="${base}.xlsx"`,
      "Access-Control-Expose-Headers":
        "Content-Disposition",
    });

    res.send(buf);
  } catch (e) {
    fail(res, e);
  }
};


/*
  Per-student history
*/
const studentHistory = async (req, res) => {
  try {
    if (roleOf(req) === "student") {
      return res.status(403).json({
        message: "Forbidden.",
      });
    }

    const db = await getConnection();

    const { where, params } = reportWhere(req);

    const rows = await queryRows(
      db,
      `
        SELECT
          st.studentid AS "StudentID",
          st.rollnumber AS "RollNumber",
          st.name AS "Name",

          COUNT(*) AS "Total",

          COALESCE(
            SUM(
              CASE
                WHEN a.status = 'Present' THEN 1
                ELSE 0
              END
            ),
            0
          ) AS "Present",

          COALESCE(
            SUM(
              CASE
                WHEN a.status = 'Absent' THEN 1
                ELSE 0
              END
            ),
            0
          ) AS "Absent"

        FROM attendance a

        JOIN students st
          ON st.studentid = a.studentid

        LEFT JOIN classes c
          ON c.classid = COALESCE(a.classid, st.classid)

        LEFT JOIN sections sec
          ON sec.sectionid = COALESCE(a.sectionid, st.sectionid)

        ${where}

        GROUP BY
          st.studentid,
          st.rollnumber,
          st.name

        ORDER BY st.name
      `,
      params
    );

    res.json(
      rows.map((x) => {
        const total = Number(x.Total) || 0;
        const present = Number(x.Present) || 0;
        const absent = Number(x.Absent) || 0;

        return {
          studentId: x.StudentID,
          rollNumber: x.RollNumber,
          name: x.Name,
          total,
          present,
          absent,
          percentage: total
            ? Math.round((present / total) * 1000) / 10
            : null,
        };
      })
    );
  } catch (e) {
    fail(res, e);
  }
};


/*
  Student attendance:
  ONLY the student linked to JWT user.
*/
const getMyAttendance = async (req, res) => {
  try {
    const id = await getLinkedStudentId(
      req.user.userId
    );

    if (id === null) {
      return res.status(404).json({
        message:
          "Your account is not linked to a student record yet.",
        code: "NOT_LINKED",
      });
    }

    const db = await getConnection();

    const rows = await queryRows(
      db,
      `
        ${REPORT_SELECT}
        WHERE a.studentid = $1
        ORDER BY a.date DESC, a.period NULLS LAST
      `,
      [id]
    );

    res.json(rows);
  } catch (e) {
    fail(res, e);
  }
};


/*
  Save one student's lecture attendance.
*/
async function saveOne(
  db,
  {
    asg,
    studentId,
    date,
    status,
    source,
    takenAt,
    allowUpdate,
  }
) {
  const existing = await queryRows(
    db,
    `
      SELECT
        attendanceid AS "AttendanceID",
        status AS "Status"

      FROM attendance

      WHERE studentid = $1
        AND date::date = $2
        AND classid = $3
        AND sectionid = $4
        AND subjectid = $5
        AND period = $6
    `,
    [
      studentId,
      date,
      asg.ClassID,
      asg.SectionID,
      asg.SubjectID,
      asg.Period,
    ]
  );

  if (existing.length) {
    if (existing[0].Status === status) {
      return "unchanged";
    }

    if (!allowUpdate) {
      return "duplicate";
    }

    await db.query(
      `
        UPDATE attendance
        SET
          status = $1,
          updatedat = CURRENT_TIMESTAMP

        WHERE attendanceid = $2
      `,
      [
        status,
        existing[0].AttendanceID,
      ]
    );

    return "updated";
  }

  const int = (v, name) => {
    const n = Number(v);

    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        `Invalid ${name}: ${v}`
      );
    }

    return n;
  };

  const hms = (v, name) => {
    const m = String(v ?? "")
      .trim()
      .match(
        /^(\d{1,2}):(\d{2})(?::(\d{2}))?/
      );

    if (
      !m ||
      +m[1] > 23 ||
      +m[2] > 59 ||
      +(m[3] || 0) > 59
    ) {
      throw new Error(
        `Invalid ${name}: ${v}`
      );
    }

    return `${m[1].padStart(2, "0")}:${m[2]}:${(
      m[3] || "00"
    ).padStart(2, "0")}`;
  };

  const sid = int(studentId, "StudentID");
  const classId = int(asg.ClassID, "ClassID");
  const sectionId = int(
    asg.SectionID,
    "SectionID"
  );
  const subjectId = int(
    asg.SubjectID,
    "SubjectID"
  );
  const teacherUserId = int(
    asg.TeacherUserID,
    "TeacherUserID"
  );
  const assignmentId = int(
    asg.AssignmentID,
    "AssignmentID"
  );
  const period = int(
    asg.Period,
    "Period"
  );

  const startTime = hms(
    asg.StartTime,
    "LectureStartTime"
  );

  const endTime = hms(
    asg.EndTime,
    "LectureEndTime"
  );

  const d = String(date || "").slice(0, 10);

  if (!isValidDate(d)) {
    throw new Error(
      `Invalid date: ${date}`
    );
  }

  if (
    status !== "Present" &&
    status !== "Absent"
  ) {
    throw new Error(
      `Invalid status: ${status}`
    );
  }

  const src =
    source === "Import"
      ? "Import"
      : "Manual";

  let attendanceTakenAt = null;

  if (takenAt) {
    const t = String(takenAt)
      .replace("T", " ")
      .slice(0, 19);

    if (
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
        t
      )
    ) {
      throw new Error(
        `Invalid AttendanceTakenAt: ${takenAt}`
      );
    }

    attendanceTakenAt = t;
  }

  console.log(
    "[ATTENDANCE INSERT]",
    {
      studentId: sid,
      date: d,
      status,
      classId,
      sectionId,
      subjectId,
      teacherUserId,
      assignmentId,
      period,
      startTime,
      endTime,
      source: src,
    }
  );

  await db.query(
    `
      INSERT INTO attendance
      (
        studentid,
        date,
        status,
        classid,
        sectionid,
        subjectid,
        teacheruserid,
        assignmentid,
        period,
        lecturestarttime,
        lectureendtime,
        attendancetakenat,
        createdat,
        source
      )
      VALUES
      (
        $1,
        $2::date,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::time,
        $11::time,
        $12::timestamp,
        CURRENT_TIMESTAMP,
        $13
      )
    `,
    [
      sid,
      d,
      status,
      classId,
      sectionId,
      subjectId,
      teacherUserId,
      assignmentId,
      period,
      startTime,
      endTime,
      attendanceTakenAt,
      src,
    ]
  );

  return "inserted";
}


/*
  Teacher assignment query.
*/
const ASG_SQL = `
  SELECT
    ta.assignmentid AS "AssignmentID",
    ta.teacheruserid AS "TeacherUserID",
    ta.classid AS "ClassID",
    ta.sectionid AS "SectionID",
    ta.subjectid AS "SubjectID",
    ta.period AS "Period",

    ${T("ta.starttime")} AS "StartTime",
    ${T("ta.endtime")} AS "EndTime",

    c.classnumber AS "ClassNumber",
    s.sectionname AS "SectionName",
    sub.subjectname AS "SubjectName"

  FROM teacherassignments ta

  JOIN classes c
    ON c.classid = ta.classid

  JOIN sections s
    ON s.sectionid = ta.sectionid

  JOIN subjects sub
    ON sub.subjectid = ta.subjectid
`;


function notification(stu, asg, date) {
  const message = buildAbsentMessage({
    name: stu.Name,
    date,
    classNumber: asg.ClassNumber,
    section: asg.SectionName,
    subject: asg.SubjectName,
    period: asg.Period,
    start: asg.StartTime,
    end: asg.EndTime,
  });

  return {
    studentId: Number(stu.StudentID),
    name: stu.Name,
    parentName: stu.ParentName || null,
    phone: stu.ParentPhone,
    message,
    validPhone: !!toIntlPhone(stu.ParentPhone),
    url: whatsappUrl(
      stu.ParentPhone,
      message
    ),
  };
}


/*
  POST /attendance/mark-bulk
*/
const markBulk = async (req, res) => {
  const {
    assignmentId,
    date,
    records,
  } = req.body;

  if (!isValidDate(date)) {
    return res.status(400).json({
      message:
        "A valid date (YYYY-MM-DD) is required.",
    });
  }

  if (date > todayString()) {
    return res.status(400).json({
      message:
        "Attendance cannot be marked for a future date.",
    });
  }

  if (
    !Array.isArray(records) ||
    !records.length
  ) {
    return res.status(400).json({
      message:
        "No attendance records supplied.",
    });
  }

  try {
    const db = await getConnection();

    const admin =
      roleOf(req) === "admin";

    /*
      Legacy date-level attendance.
    */
    if (!assignmentId) {
      if (!admin) {
        return res.status(400).json({
          message:
            "Select an assigned class/lecture before marking attendance.",
        });
      }

      const failed = [];
      let saved = 0;
      const notifications = [];

      for (const r of records) {
        const status = normalizeStatus(
          r.status
        );

        if (!status) {
          failed.push({
            studentId: r.studentId,
            reason: "Invalid status.",
          });

          continue;
        }

        try {
          const students = await queryRows(
            db,
            `
              SELECT
                name AS "Name",
                parentphone AS "ParentPhone"

              FROM students

              WHERE studentid = $1
            `,
            [r.studentId]
          );

          if (!students.length) {
            failed.push({
              studentId: r.studentId,
              reason:
                "Student not found.",
            });

            continue;
          }

          const existing =
            await queryRows(
              db,
              `
                SELECT attendanceid AS "AttendanceID"

                FROM attendance

                WHERE studentid = $1
                  AND date::date = $2
                  AND period IS NULL
              `,
              [
                r.studentId,
                date,
              ]
            );

          if (existing.length) {
            await db.query(
              `
                UPDATE attendance
                SET
                  status = $1,
                  updatedat = CURRENT_TIMESTAMP

                WHERE attendanceid = $2
              `,
              [
                status,
                existing[0].AttendanceID,
              ]
            );
          } else {
            await db.query(
              `
                INSERT INTO attendance
                (
                  studentid,
                  date,
                  status,
                  createdat,
                  attendancetakenat,
                  source
                )
                VALUES
                (
                  $1,
                  $2::date,
                  $3,
                  CURRENT_TIMESTAMP,
                  CURRENT_TIMESTAMP,
                  'Manual'
                )
              `,
              [
                r.studentId,
                date,
                status,
              ]
            );
          }

          saved++;

          if (status === "Absent") {
            notifications.push({
              studentId:
                Number(r.studentId),
              name:
                students[0].Name,
              phone:
                students[0].ParentPhone,
              url: openWhatsApp(
                students[0].ParentPhone,
                students[0].Name,
                date
              ),
            });
          }
        } catch (e) {
          failed.push({
            studentId: r.studentId,
            reason: e.message,
          });
        }
      }

      return res.json({
        message:
          `Attendance saved for ${saved} student(s).`,
        saved,
        failed,
        notifications,
      });
    }


    /*
      Lecture assignment
    */
    const assignments =
      await queryRows(
        db,
        `${ASG_SQL}
         WHERE ta.assignmentid = $1`,
        [assignmentId]
      );

    if (!assignments.length) {
      return res.status(404).json({
        message:
          "Assignment not found.",
      });
    }

    const asg = assignments[0];

    if (
      !admin &&
      Number(asg.TeacherUserID) !==
        Number(req.user.userId)
    ) {
      return res.status(403).json({
        message:
          "This class is not assigned to you.",
      });
    }

    /*
      Teachers may edit a lecture's attendance
      only on the day it was taken.
      Admin can edit any day.
    */
    const allowUpdate =
      admin ||
      date === todayString();

    const out = {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      duplicates: 0,
    };

    const failed = [];
    const notifications = [];

    for (const r of records) {
      const status = normalizeStatus(
        r.status
      );

      if (!status) {
        failed.push({
          studentId: r.studentId,
          reason:
            "Status must be Present or Absent.",
        });

        continue;
      }

      try {
        const students =
          await queryRows(
            db,
            `
              SELECT
                studentid AS "StudentID",
                name AS "Name",
                parentname AS "ParentName",
                parentphone AS "ParentPhone",
                classid AS "ClassID",
                sectionid AS "SectionID"

              FROM students

              WHERE studentid = $1
            `,
            [r.studentId]
          );

        if (!students.length) {
          failed.push({
            studentId: r.studentId,
            reason:
              "Student not found.",
          });

          continue;
        }

        const student = students[0];

        if (
          Number(student.ClassID) !==
            Number(asg.ClassID) ||
          Number(student.SectionID) !==
            Number(asg.SectionID)
        ) {
          failed.push({
            studentId: r.studentId,
            reason:
              `${student.Name} does not belong to Class ${asg.ClassNumber}-${asg.SectionName}.`,
          });

          continue;
        }

        let result;

        try {
          result = await saveOne(
            db,
            {
              asg,
              studentId:
                r.studentId,
              date,
              status,
              source: "Manual",
              allowUpdate,
            }
          );
        } catch (e) {
          if (isDupError(e)) {
            result = "duplicate";
          } else {
            throw e;
          }
        }

        if (result === "inserted") {
          out.inserted++;
        } else if (
          result === "updated"
        ) {
          out.updated++;
        } else if (
          result === "unchanged"
        ) {
          out.unchanged++;
        } else {
          out.duplicates++;

          failed.push({
            studentId:
              r.studentId,
            reason:
              `Attendance already exists for ${student.Name} in this lecture; it can only be edited by the teacher on the same day (or by an Admin).`,
          });
        }

        if (
          status === "Absent" &&
          (
            result === "inserted" ||
            result === "updated"
          )
        ) {
          notifications.push(
            notification(
              student,
              asg,
              date
            )
          );
        }
      } catch (e) {
        failed.push({
          studentId: r.studentId,
          reason: e.message,
        });
      }
    }

    const saved =
      out.inserted +
      out.updated;

    res.json({
      message:
        `Attendance saved: ${out.inserted} new, ${out.updated} updated, ${out.unchanged} already recorded` +
        (
          failed.length
            ? `, ${failed.length} failed.`
            : "."
        ),

      saved,
      ...out,
      failed,
      notifications,
    });
  } catch (e) {
    fail(res, e);
  }
};


/*
  Legacy single mark
*/
const markAttendance = async (
  req,
  res
) => {
  const {
    studentId,
    date,
    status,
    assignmentId,
  } = req.body;

  if (
    !studentId ||
    !date ||
    !status
  ) {
    return res.status(400).json({
      message:
        "Student ID, date, and status are required.",
    });
  }

  req.body = {
    assignmentId,
    date,
    records: [
      {
        studentId,
        status,
      },
    ],
  };

  const orig = res.json.bind(res);

  res.json = (b) =>
    orig(
      b && b.notifications
        ? {
            ...b,
            whatsappTriggered:
              b.notifications.length > 0,
            whatsappUrl:
              b.notifications[0]?.url ||
              null,
          }
        : b
    );

  return markBulk(req, res);
};


/*
  GET /attendance/absent-notifications
*/
const absentNotifications = async (
  req,
  res
) => {
  try {
    const db = await getConnection();

    const {
      assignmentId,
    } = req.query;

    const date =
      req.query.date ||
      todayString();

    if (!assignmentId) {
      return res.status(400).json({
        message:
          "assignmentId is required.",
      });
    }

    const assignments =
      await queryRows(
        db,
        `${ASG_SQL}
         WHERE ta.assignmentid = $1`,
        [assignmentId]
      );

    if (!assignments.length) {
      return res.status(404).json({
        message:
          "Assignment not found.",
      });
    }

    const asg = assignments[0];

    if (
      roleOf(req) === "teacher" &&
      Number(asg.TeacherUserID) !==
        Number(req.user.userId)
    ) {
      return res.status(403).json({
        message:
          "This class is not assigned to you.",
      });
    }

    const rows =
      await queryRows(
        db,
        `
          SELECT
            st.studentid AS "StudentID",
            st.name AS "Name",
            st.parentname AS "ParentName",
            st.parentphone AS "ParentPhone"

          FROM attendance at

          JOIN students st
            ON st.studentid = at.studentid

          WHERE at.assignmentid = $1
            AND at.date::date = $2
            AND at.status = 'Absent'
        `,
        [
          assignmentId,
          date,
        ]
      );

    res.json(
      rows.map((s) =>
        notification(
          s,
          asg,
          date
        )
      )
    );
  } catch (e) {
    fail(res, e);
  }
};


/*
  Bulk attendance import
*/
const importAttendance = async (
  req,
  res
) => {
  let rows;

  try {
    rows = parseFile(
      req.body.filename,
      req.body.contentBase64
    );
  } catch (e) {
    return res.status(400).json({
      message: e.message,
    });
  }

  try {
    const db = await getConnection();

    const admin =
      roleOf(req) === "admin";

    const result = {
      total: rows.length,
      imported: 0,
      failed: 0,
      duplicates: 0,
      failures: [],
      duplicateRows: [],
      notifications: [],
    };

    for (const r of rows) {
      await (async () => {
        const bad = (reason) => {
          result.failed++;

          result.failures.push({
            row: r.__row,
            reason,
          });
        };

        try {
          const sid = String(
            pickField(
              r,
              "StudentID",
              "Student ID"
            )
          ).trim();

          const roll = String(
            pickField(
              r,
              "RollNumber",
              "Roll No",
              "Roll"
            )
          ).trim();

          const cls =
            parseClassNumber(
              pickField(r, "Class")
            );

          const secName = String(
            pickField(r, "Section")
          )
            .trim()
            .toUpperCase();

          const subjName = String(
            pickField(r, "Subject")
          ).trim();

          const teacherVal = String(
            pickField(
              r,
              "Teacher",
              "TeacherUsername",
              "TeacherName"
            )
          ).trim();

          const period = Number(
            pickField(
              r,
              "Period",
              "Lecture",
              "LecturePeriod"
            )
          );

          const dateRaw = pickField(
            r,
            "Date",
            "AttendanceDate"
          );

          const date =
            parseDate(dateRaw);

          const status =
            normalizeStatus(
              pickField(r, "Status")
            );

          const startRaw = pickField(
            r,
            "LectureStartTime",
            "StartTime"
          );

          const endRaw = pickField(
            r,
            "LectureEndTime",
            "EndTime"
          );

          const takenRaw = pickField(
            r,
            "AttendanceTakenAt",
            "TakenAt"
          );

          if (!cls) {
            return bad(
              "Class is missing or not between 1 and 12."
            );
          }

          if (!secName) {
            return bad(
              "Section is missing."
            );
          }

          if (!subjName) {
            return bad(
              "Subject is missing."
            );
          }

          if (
            !Number.isInteger(period) ||
            period < 1
          ) {
            return bad(
              "Lecture/Period is missing or invalid."
            );
          }

          if (!date) {
            return bad(
              `Invalid date "${dateRaw}".`
            );
          }

          if (
            date > todayString()
          ) {
            return bad(
              "Date is in the future."
            );
          }

          if (!status) {
            return bad(
              "Status must be Present or Absent."
            );
          }


          /*
            Class
          */
          const classes =
            await queryRows(
              db,
              `
                SELECT
                  classid AS "ClassID"

                FROM classes

                WHERE classnumber = $1
              `,
              [cls]
            );

          if (!classes.length) {
            return bad(
              `Class ${cls} does not exist.`
            );
          }

          const classRow =
            classes[0];


          /*
            Section
          */
          const sections =
            await queryRows(
              db,
              `
                SELECT
                  sectionid AS "SectionID"

                FROM sections

                WHERE classid = $1
                  AND sectionname = $2
              `,
              [
                classRow.ClassID,
                secName,
              ]
            );

          if (!sections.length) {
            return bad(
              `Section ${secName} does not exist in Class ${cls}.`
            );
          }

          const sectionRow =
            sections[0];


          /*
            Subject
          */
          const subjects =
            await queryRows(
              db,
              `
                SELECT
                  subjectid AS "SubjectID"

                FROM subjects

                WHERE subjectname = $1
              `,
              [subjName]
            );

          if (!subjects.length) {
            return bad(
              `Subject "${subjName}" does not exist.`
            );
          }

          const subjectRow =
            subjects[0];


          /*
            Student
          */
          let students;

          if (/^\d+$/.test(sid)) {
            students =
              await queryRows(
                db,
                `
                  SELECT
                    studentid AS "StudentID",
                    name AS "Name",
                    parentphone AS "ParentPhone",
                    classid AS "ClassID",
                    sectionid AS "SectionID"

                  FROM students

                  WHERE studentid = $1
                `,
                [sid]
              );
          } else if (roll) {
            students =
              await queryRows(
                db,
                `
                  SELECT
                    studentid AS "StudentID",
                    name AS "Name",
                    parentphone AS "ParentPhone",
                    classid AS "ClassID",
                    sectionid AS "SectionID"

                  FROM students

                  WHERE rollnumber = $1
                    AND classid = $2
                    AND sectionid = $3
                `,
                [
                  roll,
                  classRow.ClassID,
                  sectionRow.SectionID,
                ]
              );
          } else {
            return bad(
              "StudentID or Roll Number is required."
            );
          }

          if (!students.length) {
            return bad(
              "Student not found."
            );
          }

          const stu =
            students[0];

          if (
            Number(stu.ClassID) !==
              Number(classRow.ClassID) ||
            Number(stu.SectionID) !==
              Number(sectionRow.SectionID)
          ) {
            return bad(
              `${stu.Name} does not belong to Class ${cls}-${secName}.`
            );
          }


          /*
            Teacher
          */
          let teacherId;

          if (admin) {
            if (!teacherVal) {
              return bad(
                "Teacher is missing."
              );
            }

            const teachers =
              await queryRows(
                db,
                `
                  SELECT
                    userid AS "UserId"

                  FROM users

                  WHERE role = 'Teacher'
                    AND (
                      username = $1
                      OR fullname = $2
                    )
                `,
                [
                  teacherVal,
                  teacherVal,
                ]
              );

            if (!teachers.length) {
              return bad(
                `Teacher "${teacherVal}" not found.`
              );
            }

            if (teachers.length > 1) {
              return bad(
                `Teacher name "${teacherVal}" is ambiguous - use the username.`
              );
            }

            teacherId =
              teachers[0].UserId;
          } else {
            teacherId =
              req.user.userId;
          }


          /*
            Teacher assignment
          */
          const assignments =
            await queryRows(
              db,
              `
                ${ASG_SQL}

                WHERE ta.teacheruserid = $1
                  AND ta.classid = $2
                  AND ta.sectionid = $3
                  AND ta.subjectid = $4
                  AND ta.period = $5
              `,
              [
                teacherId,
                classRow.ClassID,
                sectionRow.SectionID,
                subjectRow.SubjectID,
                period,
              ]
            );

          if (!assignments.length) {
            return bad(
              "No teacher assignment exists for this Teacher + Class + Section + Subject + Period."
            );
          }

          const asg =
            assignments[0];


          /*
            Check lecture time
          */
          if (
            startRaw !== "" &&
            parseTime(startRaw) !==
              asg.StartTime
          ) {
            return bad(
              `Lecture start time does not match the assignment (${asg.StartTime}).`
            );
          }

          if (
            endRaw !== "" &&
            parseTime(endRaw) !==
              asg.EndTime
          ) {
            return bad(
              `Lecture end time does not match the assignment (${asg.EndTime}).`
            );
          }


          /*
            Attendance taken time
          */
          let takenAt = null;

          if (takenRaw !== "") {
            takenAt =
              parseDateTime(
                takenRaw,
                date
              );

            if (!takenAt) {
              return bad(
                `Invalid Attendance Taken At "${takenRaw}".`
              );
            }
          }


          /*
            Save attendance
          */
          let outcome;

          try {
            outcome =
              await saveOne(
                db,
                {
                  asg,
                  studentId:
                    stu.StudentID,
                  date,
                  status,
                  source: "Import",
                  takenAt,
                  allowUpdate: false,
                }
              );
          } catch (e) {
            if (isDupError(e)) {
              outcome = "duplicate";
            } else {
              throw e;
            }
          }

          if (
            outcome === "inserted"
          ) {
            result.imported++;

            if (
              status === "Absent"
            ) {
              result.notifications.push(
                notification(
                  stu,
                  asg,
                  date
                )
              );
            }
          } else {
            result.duplicates++;

            result.duplicateRows.push({
              row: r.__row,
              reason:
                `Attendance already exists for ${stu.Name} on ${date}, Period ${period}.`,
            });
          }
        } catch (e) {
          bad(e.message);
        }
      })();
    }

    res.json({
      message:
        `Import finished: ${result.imported} imported, ${result.duplicates} duplicate, ${result.failed} failed.`,
      ...result,
    });
  } catch (e) {
    fail(res, e);
  }
};


module.exports = {
  exportAttendance,
  studentHistory,
  markAttendance,
  markBulk,
  getAttendanceReport,
  getAttendanceSummary,
  getMyAttendance,
  absentNotifications,
  importAttendance,
};