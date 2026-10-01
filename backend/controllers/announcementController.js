const { getConnection } = require("../config/db");
const { isValidDate } = require("../config/helpers");

const TYPES = new Set(["General", "Exam", "Holiday", "Event", "Important", "Other"]);
const AUDIENCES = new Set(["Everyone", "Teachers", "Students"]);
const fail = (res, error) => {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error("[ANNOUNCEMENT API ERROR]", error.message);
  return res.status(500).json({ message: "Announcement operation failed." });
};
const requestError = (status, message) => Object.assign(new Error(message), { status });

function parseAnnouncement(body) {
  const title = String(body.title || "").trim();
  const message = String(body.message || "").trim();
  const type = String(body.type || "");
  const targetAudience = String(body.targetAudience || "");
  const publishDate = String(body.publishDate || "");
  const expiryDate = body.expiryDate ? String(body.expiryDate) : null;
  if (!title || title.length > 160) throw requestError(400, "Title is required and must be 160 characters or fewer.");
  if (!message || message.length > 20000) throw requestError(400, "Message is required and must be 20,000 characters or fewer.");
  if (!TYPES.has(type)) throw requestError(400, "Select a valid announcement type.");
  if (!AUDIENCES.has(targetAudience)) throw requestError(400, "Select a valid target audience.");
  if (!isValidDate(publishDate)) throw requestError(400, "Publish date must be a valid YYYY-MM-DD date.");
  if (expiryDate && !isValidDate(expiryDate)) throw requestError(400, "Expiry date must be a valid YYYY-MM-DD date.");
  if (expiryDate && expiryDate < publishDate) throw requestError(400, "Expiry date cannot be before the publish date.");
  return { title, message, type, targetAudience, publishDate, expiryDate };
}

const list = async (req, res) => {
  try {
    const db = await getConnection();
    const isAdmin = String(req.user.role).toLowerCase() === "admin";
    const rows = isAdmin
      ? await db.query(`SELECT AnnouncementID, Title, AnnouncementType AS Type, TargetAudience,
          CONVERT(VARCHAR(10), PublishDate, 23) AS PublishDate,
          CONVERT(VARCHAR(10), ExpiryDate, 23) AS ExpiryDate, CAST(IsPublished AS INT) AS IsPublished, CAST(IsArchived AS INT) AS IsArchived,
          CONVERT(VARCHAR(19), CreatedAt, 120) AS CreatedAt, Message
        FROM Announcements ORDER BY CreatedAt DESC, AnnouncementID DESC`)
      : await db.query(`SELECT AnnouncementID, Title, AnnouncementType AS Type, TargetAudience,
          CONVERT(VARCHAR(10), PublishDate, 23) AS PublishDate,
          CONVERT(VARCHAR(10), ExpiryDate, 23) AS ExpiryDate, Message
        FROM Announcements
        WHERE IsArchived = 0 AND IsPublished = 1
          AND PublishDate <= CONVERT(date, SYSDATETIME())
          AND (ExpiryDate IS NULL OR ExpiryDate >= CONVERT(date, SYSDATETIME()))
          AND TargetAudience IN ('Everyone', ?)
        ORDER BY PublishDate DESC, AnnouncementID DESC`,
        [String(req.user.role).toLowerCase() === "teacher" ? "Teachers" : "Students"]);
    res.json(rows);
  } catch (e) { fail(res, e); }
};

const create = async (req, res) => {
  let announcement;
  try { announcement = parseAnnouncement(req.body || {}); }
  catch (e) { return fail(res, e); }
  try {
    const db = await getConnection();
    const rows = await db.query(
      `INSERT INTO Announcements (Title, Message, AnnouncementType, TargetAudience, PublishDate, ExpiryDate, CreatedByUserID)
       OUTPUT INSERTED.AnnouncementID AS AnnouncementID
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [announcement.title, announcement.message, announcement.type, announcement.targetAudience,
        announcement.publishDate, announcement.expiryDate, req.user.userId]
    );
    res.status(201).json({ message: "Announcement created as unpublished.", announcementId: rows[0].AnnouncementID });
  } catch (e) { fail(res, e); }
};

const update = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid announcement ID." });
  let announcement;
  try { announcement = parseAnnouncement(req.body || {}); }
  catch (e) { return fail(res, e); }
  try {
    const db = await getConnection();
    const rows = await db.query(
      `UPDATE Announcements SET Title = ?, Message = ?, AnnouncementType = ?, TargetAudience = ?, PublishDate = ?, ExpiryDate = ?, UpdatedAt = SYSDATETIME()
       OUTPUT INSERTED.AnnouncementID AS AnnouncementID WHERE AnnouncementID = ?`,
      [announcement.title, announcement.message, announcement.type, announcement.targetAudience,
        announcement.publishDate, announcement.expiryDate, id]
    );
    if (!rows.length) return res.status(404).json({ message: "Announcement not found." });
    res.json({ message: "Announcement updated.", announcementId: rows[0].AnnouncementID });
  } catch (e) { fail(res, e); }
};

const setPublished = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid announcement ID." });
  if (typeof req.body?.isPublished !== "boolean") return res.status(400).json({ message: "isPublished must be true or false." });
  try {
    const db = await getConnection();
    const rows = await db.query(
      `UPDATE Announcements SET IsPublished = ?, UpdatedAt = SYSDATETIME()
       OUTPUT INSERTED.AnnouncementID AS AnnouncementID
       WHERE AnnouncementID = ? AND IsArchived = 0`,
      [req.body.isPublished ? 1 : 0, id]
    );
    if (!rows.length) {
      const exists = await db.query("SELECT 1 AS x FROM Announcements WHERE AnnouncementID = ?", [id]);
      return exists.length
        ? res.status(409).json({ message: "Archived announcements cannot be published or unpublished." })
        : res.status(404).json({ message: "Announcement not found." });
    }
    res.json({ message: req.body.isPublished ? "Announcement published." : "Announcement unpublished." });
  } catch (e) { fail(res, e); }
};

const archive = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid announcement ID." });
  try {
    const db = await getConnection();
    const rows = await db.query(
      `UPDATE Announcements SET IsArchived = 1, IsPublished = 0, UpdatedAt = SYSDATETIME()
       OUTPUT INSERTED.AnnouncementID AS AnnouncementID WHERE AnnouncementID = ? AND IsArchived = 0`,
      [id]
    );
    if (!rows.length) {
      const exists = await db.query("SELECT 1 AS x FROM Announcements WHERE AnnouncementID = ?", [id]);
      return exists.length
        ? res.status(409).json({ message: "Announcement is already archived." })
        : res.status(404).json({ message: "Announcement not found." });
    }
    res.json({ message: "Announcement archived." });
  } catch (e) { fail(res, e); }
};

module.exports = { list, create, update, setPublished, archive };