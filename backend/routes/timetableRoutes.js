const express = require("express");
const c = require("../controllers/timetableController");
const verifyToken = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const router = express.Router();
const admin = [verifyToken, requireRole("Admin")];

router.get("/admin", ...admin, c.getAdminTimetable);
router.post("/admin/entries", ...admin, c.saveAdminEntry);
router.put("/admin/entries/:id", ...admin, c.saveAdminEntry);
router.delete("/admin/entries/:id", ...admin, c.deleteAdminEntry);
router.post("/admin/copy", ...admin, c.copyAdminTimetable);
router.get("/teacher/me", verifyToken, requireRole("Teacher"), c.getTeacherTimetable);
router.get("/teacher/entries/:id/roster", verifyToken, requireRole("Teacher"), c.getTeacherRoster);

module.exports = router;