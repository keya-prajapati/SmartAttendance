const express = require("express");
const { register, updateProfile, changePassword } = require("../controllers/authController");
const verifyToken = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.put("/profile", verifyToken, updateProfile);
router.put("/password", verifyToken, changePassword);

module.exports = router;
