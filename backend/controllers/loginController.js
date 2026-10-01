const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getConnection } = require("../config/db");

const login = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        message: "Username, password and role are required."
      });
    }

    const allowedRoles = ["Admin", "Teacher", "Student"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role."
      });
    }

    const db = await getConnection();

    const result = await db.query(`
      SELECT u.UserId, u.FullName, u.Username, u.PasswordHash, u.Role, u.Phone,
             u.StudentID, st.IsActive AS StudentIsActive
      FROM Users u
      LEFT JOIN Students st ON st.StudentID = u.StudentID
      WHERE u.Username = '${username.replace(/'/g, "''")}'
    `);

    if (result.length === 0) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    const user = result[0];

    // Backend role verification
    if (user.Role !== role) {
      return res.status(403).json({
        message: `This account is registered as ${user.Role}.`
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.PasswordHash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid username or password."
      });
    }

    if (user.Role === "Student" && user.StudentID != null && Number(user.StudentIsActive) !== 1) {
      return res.status(403).json({ message: "This student account has been deactivated." });
    }

    const token = jwt.sign(
      {
        userId: user.UserId,
        username: user.Username,
        role: user.Role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d"
      }
    );

    res.json({
      message: "Login successful.",
      token,
      user: {
        userId: user.UserId,
        fullName: user.FullName,
        username: user.Username,
        role: user.Role,
        phone: user.Phone
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Login failed."
    });
  }
};

module.exports = {
  login
};