const bcrypt = require("bcryptjs");
const { getConnection } = require("../config/db");

const register = async (req, res) => {
  try {
    const { fullName, username, password, role, phone } = req.body;

    if (!fullName || !username || !password || !role) {
      return res.status(400).json({
        message: "Full name, username, password and role are required."
      });
    }

    const allowedRoles = ["Admin", "Teacher", "Student"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role."
      });
    }

    const db = await getConnection();

    const existingUser = await db.query(
      `SELECT UserId FROM Users WHERE Username = '${username.replace(/'/g, "''")}'`
    );

    if (existingUser.length > 0) {
      return res.status(409).json({
        message: "Username already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await db.query(`
      INSERT INTO Users
      (FullName, Username, PasswordHash, Role, Phone)
      VALUES
      (
        '${fullName.replace(/'/g, "''")}',
        '${username.replace(/'/g, "''")}',
        '${passwordHash}',
        '${role}',
        '${phone ? phone.replace(/'/g, "''") : ""}'
      )
    `);

    res.status(201).json({
      message: "Registration successful."
    });

  } catch (error) {
    console.error("Registration error:", error);

    res.status(500).json({
      message: "Registration failed."
    });
  }
};

module.exports = {
  register
};
/* ---- profile / password (used by the Settings page) ---- */
const updateProfile = async (req, res) => {
  const { fullName, phone } = req.body;
  if (!fullName || String(fullName).trim().length < 2) return res.status(400).json({ message: "Enter your full name." });
  try {
    const db = await getConnection();
    await db.query("UPDATE Users SET FullName = ?, Phone = ? WHERE UserId = ?", [String(fullName).trim(), String(phone || "").trim(), req.user.userId]);
    const r = await db.query("SELECT UserId, FullName, Username, Role, Phone FROM Users WHERE UserId = ?", [req.user.userId]);
    const u = r[0];
    res.json({ message: "Profile updated.", user: { userId: u.UserId, fullName: u.FullName, username: u.Username, role: u.Role, phone: u.Phone } });
  } catch (e) { res.status(500).json({ message: "Could not update profile." }); }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || String(newPassword).length < 6) return res.status(400).json({ message: "New password must be at least 6 characters." });
  try {
    const db = await getConnection();
    const r = await db.query("SELECT PasswordHash FROM Users WHERE UserId = ?", [req.user.userId]);
    if (!r.length || !(await bcrypt.compare(currentPassword, r[0].PasswordHash))) return res.status(400).json({ message: "Current password is incorrect." });
    await db.query("UPDATE Users SET PasswordHash = ? WHERE UserId = ?", [await bcrypt.hash(newPassword, 10), req.user.userId]);
    res.json({ message: "Password changed." });
  } catch (e) { res.status(500).json({ message: "Could not change password." }); }
};

module.exports.updateProfile = updateProfile;
module.exports.changePassword = changePassword;
