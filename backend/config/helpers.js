const { getConnection } = require("./db");

/* Returns the Students.StudentID linked to a Users row, or null. */
async function getLinkedStudentId(userId) {
  try {
    const db = await getConnection();
    const rows = await db.query("SELECT StudentID FROM Users WHERE UserId = ?", [userId]);
    const id = rows && rows[0] ? rows[0].StudentID : null;
    return id === null || id === undefined ? null : Number(id);
  } catch (err) {
    console.error("getLinkedStudentId:", err.message);
    return null;
  }
}

const isValidDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const todayString = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const normalizeStatus = (s) => {
  const v = String(s || "").trim().toLowerCase();
  if (v === "present" || v === "p") return "Present";
  if (v === "absent" || v === "a") return "Absent";
  return null;
};

module.exports = { getLinkedStudentId, isValidDate, todayString, normalizeStatus };
