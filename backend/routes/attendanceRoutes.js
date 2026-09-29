const express = require("express");
const c = require("../controllers/attendanceController");
const verifyToken = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const router = express.Router();

router.post("/mark", verifyToken, requireRole("Admin", "Teacher"), c.markAttendance);
router.post("/mark-bulk", verifyToken, requireRole("Admin", "Teacher"), c.markBulk);
router.post("/import", verifyToken, requireRole("Admin", "Teacher"), c.importAttendance);
router.get("/report", verifyToken, requireRole("Admin", "Teacher"), c.getAttendanceReport);
router.get("/export", verifyToken, requireRole("Admin", "Teacher"), c.exportAttendance);
router.get("/history", verifyToken, requireRole("Admin", "Teacher"), c.studentHistory);
router.get("/summary", verifyToken, requireRole("Admin", "Teacher"), c.getAttendanceSummary);
router.get("/absent-notifications", verifyToken, requireRole("Admin", "Teacher"), c.absentNotifications);
router.get("/my", verifyToken, requireRole("Student"), c.getMyAttendance);

module.exports = router;
