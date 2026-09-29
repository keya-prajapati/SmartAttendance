const express = require("express");
const c = require("../controllers/studentController");
const verifyToken = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const router = express.Router();

const att = require("../controllers/attendanceController");
router.get("/me", verifyToken, requireRole("Student"), c.getMe);
router.get("/me/attendance", verifyToken, requireRole("Student"), att.getMyAttendance);
router.get("/me/attendance/summary", verifyToken, requireRole("Student"), c.getMyAttendanceSummary);
router.get("/me/timetable", verifyToken, requireRole("Student"), c.getMyTimetable);
router.post("/create-missing-logins", verifyToken, requireRole("Admin"), c.createMissingLogins);
router.get("/:id/login-info", verifyToken, requireRole("Admin"), c.getLoginInfo);
router.post("/:id/reset-password", verifyToken, requireRole("Admin"), c.resetPassword);
router.get("/all", verifyToken, requireRole("Admin", "Teacher"), c.getStudents);
router.get("/accounts", verifyToken, requireRole("Admin"), c.getAccounts);
router.post("/add", verifyToken, requireRole("Admin"), c.addStudent);
router.post("/import", verifyToken, requireRole("Admin"), c.importStudents);
router.put("/:id/link", verifyToken, requireRole("Admin"), c.linkAccount);
router.put("/:id", verifyToken, requireRole("Admin"), c.updateStudent);
router.delete("/:id", verifyToken, requireRole("Admin"), c.deleteStudent);

module.exports = router;
