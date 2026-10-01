const express = require("express");
const c = require("../controllers/announcementController");
const verifyToken = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const router = express.Router();
const readers = [verifyToken, requireRole("Admin", "Teacher", "Student")];
const admin = [verifyToken, requireRole("Admin")];

router.get("/", ...readers, c.list);
router.post("/", ...admin, c.create);
router.put("/:id", ...admin, c.update);
router.patch("/:id/publish", ...admin, c.setPublished);
router.patch("/:id/archive", ...admin, c.archive);

module.exports = router;