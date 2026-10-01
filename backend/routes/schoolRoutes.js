const express = require("express");
const m = require("../controllers/masterController");
const verifyToken = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const router = express.Router();
const admin = [verifyToken, requireRole("Admin")];
const staff = [verifyToken, requireRole("Admin", "Teacher")];

// reference data (Admin + Teacher)
router.get("/classes", ...staff, m.getClasses);
router.get("/sections", ...staff, m.getSections);
router.get("/subjects", ...staff, m.getSubjects);

// Admin management
router.put("/admin/classes/:id", ...admin, m.updateClass);
router.post("/admin/sections", ...admin, m.addSection);
router.delete("/admin/sections/:id", ...admin, m.deleteSection);
router.post("/admin/subjects", ...admin, m.addSubject);
router.put("/admin/subjects/:id", ...admin, m.updateSubject);
router.delete("/admin/subjects/:id", ...admin, m.deleteSubject);
router.get("/admin/teachers", ...admin, m.getTeachers);
router.get("/admin/assignments", ...admin, m.getAssignments);
router.post("/admin/assignments", ...admin, m.addAssignment);
router.put("/admin/assignments/:id", ...admin, m.updateAssignment);
router.delete("/admin/assignments/:id", ...admin, m.deleteAssignment);

// Teacher: identity always comes from the JWT, never from the request
router.get("/teacher/my-classes", verifyToken, requireRole("Teacher"), m.myClasses);
router.get("/lecture/:assignmentId/students", ...staff, m.lectureRoster);

module.exports = router;
