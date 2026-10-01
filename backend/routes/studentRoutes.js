const express = require("express");
const c = require("../controllers/studentController");
const verifyToken = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const router = express.Router();

router.get("/me", verifyToken, requireRole("Student"), c.getMe);
router.get("/me/timetable", verifyToken, requireRole("Student"), c.getMyTimetable);
router.get("/all", verifyToken, requireRole("Admin", "Teacher"), c.getStudents);
router.get("/accounts", verifyToken, requireRole("Admin"), c.getAccounts);
router.post("/add", verifyToken, requireRole("Admin"), c.addStudent);
router.post("/import", verifyToken, requireRole("Admin"), c.importStudents);
router.post("/:id/login", verifyToken, requireRole("Admin"), c.createStudentLogin);
router.patch("/:id/deactivate", verifyToken, requireRole("Admin"), c.deactivateStudent);
router.put("/:id/link", verifyToken, requireRole("Admin"), c.linkAccount);
router.put("/:id", verifyToken, requireRole("Admin"), c.updateStudent);
router.delete("/:id", verifyToken, requireRole("Admin"), c.deleteStudent);

module.exports = router;
