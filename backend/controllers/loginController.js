const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getConnection } = require("../config/db");

const login = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    // Validate input
    if (!username || !password || !role) {
      return res.status(400).json({
        message: "Username, password and role are required.",
      });
    }

    // Validate role
    const allowedRoles = ["Admin", "Teacher", "Student"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role.",
      });
    }

    const db = await getConnection();

    // PostgreSQL query
    const result = await db.query(
      `SELECT userid, fullname, username, passwordhash, role, phone, studentid
       FROM users
       WHERE username = $1`,
      [String(username).trim()]
    );

    // PostgreSQL returns rows inside result.rows
    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid username or password.",
      });
    }

    const user = result.rows[0];

    // Backend role verification
    if (user.role !== role) {
      return res.status(403).json({
        message: `This account is registered as ${user.role}.`,
      });
    }

    // Compare password with bcrypt hash
    const passwordMatch = await bcrypt.compare(
      password,
      user.passwordhash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid username or password.",
      });
    }

    // Create JWT
    const token = jwt.sign(
      {
        userId: user.userid,
        username: user.username,
        role: user.role,
        studentId:
          user.studentid === null || user.studentid === undefined
            ? null
            : Number(user.studentid),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    // Successful login
    res.json({
      message: "Login successful.",
      token,
      user: {
        userId: user.userid,
        fullName: user.fullname,
        username: user.username,
        role: user.role,
        phone: user.phone,
        studentId:
          user.studentid === null || user.studentid === undefined
            ? null
            : Number(user.studentid),
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Login failed.",
    });
  }
};

module.exports = {
  login,
};